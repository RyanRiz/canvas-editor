import { EDITOR_PREFIX } from '../../dataset/constant/Editor'
import { EditorZone } from '../../dataset/enum/Editor'
import { IEditorOption } from '../../interface/Editor'
// PERF-PLAN §1.5：Zone change 通知不依赖 paint cycle，从 nextTick (setTimeout 0)
// 升级到 queueMicrotask，省下一次 task-queue 回环（与 Cursor.ts:188 不同——
// 那里 moveCursorToVisible 等待 canvas paint 完成，必须停在宏任务）。
import { Draw } from '../draw/Draw'
import { I18n } from '../i18n/I18n'
import { ZoneTip } from './ZoneTip'

export class Zone {
  private readonly INDICATOR_PADDING = 2
  private readonly INDICATOR_TITLE_TRANSLATE = [20, 5]

  private draw: Draw
  private options: Required<IEditorOption>
  private i18n: I18n
  private container: HTMLDivElement

  private currentZone: EditorZone
  private indicatorContainer: HTMLDivElement | null

  constructor(draw: Draw) {
    this.draw = draw
    this.i18n = draw.getI18n()
    this.options = draw.getOptions()
    this.container = draw.getContainer()
    this.currentZone = EditorZone.MAIN
    this.indicatorContainer = null
    // 区域提示
    if (!this.options.zone.tipDisabled) {
      new ZoneTip(draw, this)
    }
  }

  public isHeaderActive(): boolean {
    return this.getZone() === EditorZone.HEADER
  }

  public isMainActive(): boolean {
    return this.getZone() === EditorZone.MAIN
  }

  public isFooterActive(): boolean {
    return this.getZone() === EditorZone.FOOTER
  }

  public getZone(): EditorZone {
    return this.currentZone
  }

  public setZone(payload: EditorZone) {
    const { header, footer } = this.options
    if (
      (!header.editable && payload === EditorZone.HEADER) ||
      (!footer.editable && payload === EditorZone.FOOTER)
    ) {
      return
    }
    if (this.currentZone === payload) return
    this.currentZone = payload
    this.draw.getRange().clearRange()
    // Per-section orientation MVP: when switching INTO header/footer on a
    // page whose direction differs from the document base, the cached
    // header/footer positionList may have been computed at the wrong
    // direction (the prior render ran with `isCompute: false` to avoid
    // unnecessary main-body recompute). Force a one-shot recompute of the
    // entering zone so the cursor's first landing X/Y come from a
    // positionList sized to the active page's direction. `Header.compute`
    // / `Footer.compute` pin `setPaintDirectionOverride(getPageDirection(
    // getPageNo()))` internally.
    if (payload === EditorZone.HEADER) {
      this.draw.getHeader().compute()
    } else if (payload === EditorZone.FOOTER) {
      this.draw.getFooter().compute()
    }
    this.draw.render({
      isSubmitHistory: false,
      isSetCursor: false,
      isCompute: false
    })
    // 指示器
    this.drawZoneIndicator()
    // 回调
    queueMicrotask(() => {
      const listener = this.draw.getListener()
      if (listener.zoneChange) {
        listener.zoneChange(payload)
      }
      const eventBus = this.draw.getEventBus()
      if (eventBus.isSubscribe('zoneChange')) {
        eventBus.emit('zoneChange', payload)
      }
    })
  }

  public getZoneByY(y: number): EditorZone {
    // 页眉底部距离页面顶部距离
    const header = this.draw.getHeader()
    const headerBottomY = header.getHeaderTop() + header.getHeight()
    // 页脚上部距离页面顶部距离
    const footer = this.draw.getFooter()
    const pageHeight = this.draw.getHeight()
    const footerTopY =
      pageHeight - (footer.getFooterBottom() + footer.getHeight())
    // 页眉：当前位置小于页眉底部位置
    if (y < headerBottomY) {
      return EditorZone.HEADER
    }
    // 页脚：当前位置大于页脚顶部位置
    if (y > footerTopY) {
      return EditorZone.FOOTER
    }
    return EditorZone.MAIN
  }

  public drawZoneIndicator() {
    this._clearZoneIndicator()
    if (!this.isHeaderActive() && !this.isFooterActive()) return
    const { scale } = this.options
    const isHeaderActive = this.isHeaderActive()
    const [offsetX, offsetY] = this.INDICATOR_TITLE_TRANSLATE
    const pageList = this.draw.getPageList()
    const pageGap = this.draw.getPageGap()
    // 创建指示器容器
    this.indicatorContainer = document.createElement('div')
    this.indicatorContainer.classList.add(`${EDITOR_PREFIX}-zone-indicator`)
    const header = this.draw.getHeader()
    const footer = this.draw.getFooter()

    // Per-section orientation MVP: each page has its own direction, hence
    // its own pageHeight + (rotated) margins. Walk pages cumulatively so a
    // landscape page sandwiched between portraits places its indicator at
    // the right Y. Read margins/innerWidth/pageHeight under each page's
    // direction override so the dashed outline spans the correct content
    // width and the footer indicator anchors against the correct bottom.
    const prevOverride = this.draw.getPaintDirectionOverride()
    try {
      let cumulativeY = 0
      for (let p = 0; p < pageList.length; p++) {
        this.draw.setPaintDirectionOverride(this.draw.getPageDirection(p))
        const pageMargins = this.draw.getMargins()
        const pageInnerWidth = this.draw.getInnerWidth()
        const pagePageHeight = this.draw.getHeight()
        const indicatorHeight = isHeaderActive
          ? header.getHeight()
          : footer.getHeight()
        const indicatorTop = isHeaderActive
          ? header.getHeaderTop()
          : pagePageHeight - footer.getFooterBottom() - indicatorHeight
        const startY = cumulativeY + indicatorTop
        const indicatorLeftX = pageMargins[3] - this.INDICATOR_PADDING
        const indicatorRightX =
          pageMargins[3] + pageInnerWidth + this.INDICATOR_PADDING
        const indicatorTopY = isHeaderActive
          ? startY - this.INDICATOR_PADDING
          : startY + indicatorHeight + this.INDICATOR_PADDING
        const indicatorBottomY = isHeaderActive
          ? startY + indicatorHeight + this.INDICATOR_PADDING
          : startY - this.INDICATOR_PADDING
        // 标题
        const indicatorTitle = document.createElement('div')
        indicatorTitle.innerText = this.i18n.t(
          `frame.${isHeaderActive ? 'header' : 'footer'}`
        )
        indicatorTitle.style.top = `${indicatorBottomY}px`
        indicatorTitle.style.transform = `translate(${offsetX * scale}px, ${
          offsetY * scale
        }px) scale(${scale})`
        this.indicatorContainer.append(indicatorTitle)

        // 上边线
        const lineTop = document.createElement('span')
        lineTop.classList.add(`${EDITOR_PREFIX}-zone-indicator-border__top`)
        lineTop.style.top = `${indicatorTopY}px`
        lineTop.style.width = `${pageInnerWidth}px`
        lineTop.style.marginLeft = `${pageMargins[3]}px`
        this.indicatorContainer.append(lineTop)

        // 左边线
        const lineLeft = document.createElement('span')
        lineLeft.classList.add(`${EDITOR_PREFIX}-zone-indicator-border__left`)
        lineLeft.style.top = `${startY}px`
        lineLeft.style.height = `${indicatorHeight}px`
        lineLeft.style.left = `${indicatorLeftX}px`
        this.indicatorContainer.append(lineLeft)

        // 下边线
        const lineBottom = document.createElement('span')
        lineBottom.classList.add(
          `${EDITOR_PREFIX}-zone-indicator-border__bottom`
        )
        lineBottom.style.top = `${indicatorBottomY}px`
        this.indicatorContainer.append(lineBottom)

        // 右边线
        const lineRight = document.createElement('span')
        lineRight.classList.add(`${EDITOR_PREFIX}-zone-indicator-border__right`)
        lineRight.style.top = `${startY}px`
        lineRight.style.height = `${indicatorHeight}px`
        lineRight.style.left = `${indicatorRightX}px`
        this.indicatorContainer.append(lineRight)

        cumulativeY += pagePageHeight + pageGap
      }
    } finally {
      this.draw.setPaintDirectionOverride(prevOverride)
    }
    this.container.append(this.indicatorContainer)
  }

  private _clearZoneIndicator() {
    this.indicatorContainer?.remove()
    this.indicatorContainer = null
  }
}
