import { ElementStyleKey } from '../../dataset/enum/ElementStyle'
import { IElement, IElementPosition } from '../../interface/Element'
import { ICurrentPosition, IPositionContext } from '../../interface/Position'
import { Draw } from '../draw/Draw'
import { Position } from '../position/Position'
import { RangeManager } from '../range/RangeManager'
import { findScrollContainer, threeClick } from '../../utils'
import { IRange, IRangeElementStyle } from '../../interface/Range'
import { mousedown } from './handlers/mousedown'
import { mouseup } from './handlers/mouseup'
import { mouseleave } from './handlers/mouseleave'
import { mousemove } from './handlers/mousemove'
import { keydown } from './handlers/keydown'
import { input } from './handlers/input'
import { cut } from './handlers/cut'
import { copy } from './handlers/copy'
import { drop } from './handlers/drop'
import click, { getWordRangeBySegmenter } from './handlers/click'
import composition from './handlers/composition'
import drag from './handlers/drag'
import { isIOS } from '../../utils/ua'
import { ICopyOption } from '../../interface/Event'

export interface ICompositionInfo {
  elementList: IElement[]
  startIndex: number
  endIndex: number
  value: string
  defaultStyle: IRangeElementStyle | null
}

export class CanvasEvent {
  public isAllowSelection: boolean
  public isComposing: boolean
  public compositionInfo: ICompositionInfo | null

  public isAllowDrag: boolean
  public isAllowDrop: boolean
  public cacheRange: IRange | null
  public cacheElementList: IElement[] | null
  public cachePositionList: IElementPosition[] | null
  public cachePositionContext: IPositionContext | null
  public mouseDownStartPosition: ICurrentPosition | null
  /**
   * Index of the list-paragraph ZERO whose marker was last clicked, used to
   * detect a "second click on the same marker" — toggles selection between
   * whole-list-block (first click) and single-item (second click). Cleared on
   * any non-marker click (mousedown handler).
   */
  public markerSelectionRow: number | null

  private draw: Draw
  private pageContainer: HTMLDivElement
  private pageList: HTMLCanvasElement[]
  private range: RangeManager
  private position: Position
  private autoScrollRafId: number | null
  private autoScrollSpeed: number
  private lastSelectionMouse: { clientX: number; clientY: number } | null

  constructor(draw: Draw) {
    this.draw = draw
    this.pageContainer = draw.getPageContainer()
    this.pageList = draw.getPageList()
    this.range = this.draw.getRange()
    this.position = this.draw.getPosition()

    this.isAllowSelection = false
    this.isComposing = false
    this.compositionInfo = null
    this.isAllowDrag = false
    this.isAllowDrop = false
    this.cacheRange = null
    this.cacheElementList = null
    this.cachePositionList = null
    this.cachePositionContext = null
    this.mouseDownStartPosition = null
    this.markerSelectionRow = null
    this.autoScrollRafId = null
    this.autoScrollSpeed = 0
    this.lastSelectionMouse = null
  }

  public getDraw(): Draw {
    return this.draw
  }

  public register() {
    this.pageContainer.addEventListener('click', this.click.bind(this))
    this.pageContainer.addEventListener('mousedown', this.mousedown.bind(this))
    this.pageContainer.addEventListener('mouseup', this.mouseup.bind(this))
    this.pageContainer.addEventListener(
      'mouseleave',
      this.mouseleave.bind(this)
    )
    this.pageContainer.addEventListener('mousemove', this.mousemove.bind(this))
    this.pageContainer.addEventListener('dblclick', this.dblclick.bind(this))
    this.pageContainer.addEventListener('dragover', this.dragover.bind(this))
    this.pageContainer.addEventListener('drop', this.drop.bind(this))
    threeClick(this.pageContainer, this.threeClick.bind(this))
  }

  public setIsAllowSelection(payload: boolean) {
    this.isAllowSelection = payload
    if (!payload) {
      this.stopAutoScroll()
      this.applyPainterStyle()
    }
  }

  public stopAutoScroll() {
    if (this.autoScrollRafId !== null) {
      cancelAnimationFrame(this.autoScrollRafId)
      this.autoScrollRafId = null
    }
    this.autoScrollSpeed = 0
    this.lastSelectionMouse = null
  }

  private updateAutoScroll(evt: MouseEvent) {
    this.lastSelectionMouse = { clientX: evt.clientX, clientY: evt.clientY }
    const scrollContainer = findScrollContainer(this.pageContainer)
    const isDocScroll = scrollContainer === document.documentElement
    let top: number
    let bottom: number
    if (isDocScroll) {
      top = 0
      bottom = window.innerHeight
    } else {
      const rect = scrollContainer.getBoundingClientRect()
      top = rect.top
      bottom = rect.bottom
    }
    const threshold = 40
    const maxSpeed = 18
    let speed = 0
    if (evt.clientY < top + threshold) {
      const dist = top + threshold - evt.clientY
      speed = -Math.min(maxSpeed, (dist / threshold) * maxSpeed)
    } else if (evt.clientY > bottom - threshold) {
      const dist = evt.clientY - (bottom - threshold)
      speed = Math.min(maxSpeed, (dist / threshold) * maxSpeed)
    }
    this.autoScrollSpeed = speed
    if (speed !== 0) {
      if (this.autoScrollRafId === null) {
        this.autoScrollRafId = requestAnimationFrame(this.autoScrollTick)
      }
    } else {
      this.stopAutoScroll()
    }
  }

  private autoScrollTick = () => {
    this.autoScrollRafId = null
    if (
      !this.isAllowSelection ||
      !this.autoScrollSpeed ||
      !this.lastSelectionMouse
    ) {
      this.autoScrollSpeed = 0
      return
    }
    const scrollContainer = findScrollContainer(this.pageContainer)
    const isDocScroll = scrollContainer === document.documentElement
    const before = isDocScroll ? window.scrollY : scrollContainer.scrollTop
    if (isDocScroll) {
      window.scrollBy(0, this.autoScrollSpeed)
    } else {
      scrollContainer.scrollTop = before + this.autoScrollSpeed
    }
    const after = isDocScroll ? window.scrollY : scrollContainer.scrollTop
    if (after !== before) {
      const { clientX, clientY } = this.lastSelectionMouse
      const target = document.elementFromPoint(clientX, clientY)
      if (
        target instanceof HTMLCanvasElement &&
        this.pageList.includes(target)
      ) {
        const rect = target.getBoundingClientRect()
        const syn = new MouseEvent('mousemove', {
          bubbles: true,
          clientX,
          clientY
        })
        Object.defineProperty(syn, 'target', { value: target })
        Object.defineProperty(syn, 'offsetX', { value: clientX - rect.left })
        Object.defineProperty(syn, 'offsetY', { value: clientY - rect.top })
        mousemove(syn, this)
      }
    }
    this.autoScrollRafId = requestAnimationFrame(this.autoScrollTick)
  }

  public setIsAllowDrag(payload: boolean) {
    this.isAllowDrag = payload
    this.isAllowDrop = payload
  }

  public clearPainterStyle() {
    this.pageList.forEach(p => {
      p.style.cursor = 'text'
    })
    this.draw.setPainterStyle(null)
  }

  public applyPainterStyle() {
    const painterStyle = this.draw.getPainterStyle()
    if (!painterStyle) return
    const isDisabled = this.draw.isReadonly() || this.draw.isDisabled()
    if (isDisabled) return
    let selection = this.range.getSelection()
    // 当前不存在选区时：判断光标处是否存词组
    if (!selection) {
      const range = getWordRangeBySegmenter(this)
      if (range) {
        const elementList = this.draw.getElementList()
        selection = elementList.slice(range.startIndex + 1, range.endIndex + 1)
      }
    }
    if (!selection) return
    const painterStyleKeys = Object.keys(painterStyle)
    selection.forEach(s => {
      painterStyleKeys.forEach(pKey => {
        const key = pKey as keyof typeof ElementStyleKey
        Reflect.set(s, key, painterStyle[key])
      })
    })
    this.draw.render({ isSetCursor: false })
    // 清除格式刷
    const painterOptions = this.draw.getPainterOptions()
    if (!painterOptions || !painterOptions.isDblclick) {
      this.clearPainterStyle()
    }
  }

  public selectAll() {
    // 光标在表格内时选择整个表格
    if (this.position.getPositionContext().isTable) {
      this.draw.getTableOperate().tableSelectAll()
    } else {
      const positionList = this.position.getPositionList()
      this.range.setRange(0, positionList.length - 1)
      // PERF — Strategy B: select-all only changes the selection rectangle,
      // not layout or text. Take the decoration-only fast path (same one used
      // by searchNavigatePre/Next) so render skips _drawPage on every visible
      // page and just re-stamps the decoration canvas. Without this, a 25-page
      // doc full-repaints all visible pages just to add the selection rect.
      this.draw.render({
        isSubmitHistory: false,
        isSetCursor: false,
        isCompute: false,
        isDecorationOnly: true
      })
    }
  }

  public mousemove(evt: MouseEvent) {
    if (this.isAllowSelection) {
      this.updateAutoScroll(evt)
    }
    mousemove(evt, this)
  }

  public mousedown(evt: MouseEvent) {
    mousedown(evt, this)
  }

  public click() {
    // IOS系统限制非用户主动触发事件的键盘弹出
    if (isIOS && !this.draw.isReadonly()) {
      this.draw.getCursor().getAgentDom().focus()
    }
  }

  public mouseup(evt: MouseEvent) {
    mouseup(evt, this)
  }

  public mouseleave(evt: MouseEvent) {
    mouseleave(evt, this)
  }

  public keydown(evt: KeyboardEvent) {
    keydown(evt, this)
  }

  public dblclick(evt: MouseEvent) {
    click.dblclick(this, evt)
  }

  public threeClick() {
    click.threeClick(this)
  }

  public input(data: string) {
    input(data, this)
  }

  public async cut() {
    await cut(this)
  }

  public async copy(options?: ICopyOption) {
    await copy(this, options)
  }

  public compositionstart() {
    composition.compositionstart(this)
  }

  public compositionend(evt: CompositionEvent) {
    composition.compositionend(this, evt)
  }

  public drop(evt: DragEvent) {
    drop(evt, this)
  }

  public dragover(evt: DragEvent | MouseEvent) {
    drag.dragover(evt, this)
  }
}
