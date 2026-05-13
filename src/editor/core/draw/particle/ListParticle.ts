import { ZERO } from '../../../dataset/constant/Common'
import { LIST_INDENT_STEP } from '../../../dataset/constant/listLevel'
import { ElementType } from '../../../dataset/enum/Element'
import { KeyMap } from '../../../dataset/enum/KeyMap'
import { ListStyle, ListType } from '../../../dataset/enum/List'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IElement, IElementPosition } from '../../../interface/Element'
import {
  IListGlyphResult,
  IListStyle,
  LIST_MAX_LEVEL
} from '../../../interface/List'
import { IRow, IRowElement } from '../../../interface/Row'
import { getUUID } from '../../../utils'
import { computeListGlyphMap } from '../../../utils/listNumbering'
import { RangeManager } from '../../range/RangeManager'
import { Draw } from '../Draw'

export interface IListLayoutInfo {
  glyphMap: Map<number, IListGlyphResult>
  gutterByListId: Map<string, number>
}

export class ListParticle {
  private draw: Draw
  private range: RangeManager
  private options: DeepRequired<IEditorOption>

  private readonly UN_COUNT_STYLE_WIDTH = 20
  private readonly MEASURE_BASE_TEXT = '0'
  private readonly LIST_GAP = 10

  constructor(draw: Draw) {
    this.draw = draw
    this.range = draw.getRange()
    this.options = draw.getOptions()
  }

  public setList(listType: ListType | null, listStyle?: ListStyle) {
    const isReadonly = this.draw.isReadonly()
    if (isReadonly) return
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    const changeElementList = this.range.getRangeParagraphElementList()
    if (!changeElementList || !changeElementList.length) return
    const isUnsetList = changeElementList.find(
      el => el.listType === listType && el.listStyle === listStyle
    )
    if (isUnsetList || !listType) {
      this.unsetList()
      return
    }
    // Word parity: when the selected paragraph(s) already belong to a list,
    // keep the existing numbering continuous across an interrupted block
    // (e.g. OL→bullet→OL stays 1,2,3,•,4,5) even if legacy data fragmented
    // the surrounding list into several listIds.
    //
    // Walk the contiguous list span around the selection (every neighbouring
    // paragraph that already has a listId) and unify everyone under one
    // listId. Then apply the new type/style only to the selected paragraphs.
    // After this, the whole logical list shares a single listId so the
    // bucket counter in computeListGlyphMap keeps counting across the
    // interruption.
    const mainList = this.draw.getElementList()
    const firstChangeIdx = mainList.indexOf(changeElementList[0])
    const lastChangeIdx = mainList.indexOf(
      changeElementList[changeElementList.length - 1]
    )
    // Walk outward from the selection only through neighbours that share the
    // SAME listId as the selected paragraph. Walking through any-listId
    // sweeps in unrelated list paragraphs (e.g. an empty list-paragraph at
    // the document top), which then pollute the counter and make numbering
    // skip ahead. Same-listId matches the "this is one logical list" intent.
    const seedListId = changeElementList.find(el => el.listId)?.listId
    let spanStart = firstChangeIdx
    if (seedListId) {
      while (spanStart > 0 && mainList[spanStart - 1]?.listId === seedListId) {
        spanStart--
      }
    }
    let spanEnd = lastChangeIdx
    if (seedListId) {
      while (
        spanEnd < mainList.length - 1 &&
        mainList[spanEnd + 1]?.listId === seedListId
      ) {
        spanEnd++
      }
    }
    const unifiedListId = seedListId || getUUID()
    const changeSet = new Set(changeElementList)
    type UnifyRecord = {
      el: IElement
      listId: string | undefined
      listType: ListType | undefined
      listStyle: ListStyle | undefined
      listLevel: number | undefined
      isSelected: boolean
    }
    const unifyRecords: UnifyRecord[] = []
    // Selected paragraphs always get rewritten — even when starting from a
    // plain (no-listId) paragraph, otherwise the toolbar can't add a list at
    // all. Neighbouring list paragraphs only get their listId unified.
    for (const el of changeElementList) {
      unifyRecords.push({
        el,
        listId: el.listId,
        listType: el.listType,
        listStyle: el.listStyle,
        listLevel: el.listLevel,
        isSelected: true
      })
    }
    for (let p = spanStart; p <= spanEnd && p < mainList.length; p++) {
      const el = mainList[p]
      if (!el.listId) continue
      if (changeSet.has(el)) continue
      unifyRecords.push({
        el,
        listId: el.listId,
        listType: el.listType,
        listStyle: el.listStyle,
        listLevel: el.listLevel,
        isSelected: false
      })
    }
    const applyForward = () => {
      for (const rec of unifyRecords) {
        rec.el.listId = unifiedListId
        if (rec.isSelected) {
          rec.el.listType = listType
          rec.el.listStyle = listStyle
          rec.el.listLevel = 1
        }
      }
    }
    const applyBackward = () => {
      for (const rec of unifyRecords) {
        if (rec.listId === undefined) {
          delete rec.el.listId
        } else {
          rec.el.listId = rec.listId
        }
        if (rec.listType === undefined) {
          delete rec.el.listType
        } else {
          rec.el.listType = rec.listType
        }
        if (rec.listStyle === undefined) {
          delete rec.el.listStyle
        } else {
          rec.el.listStyle = rec.listStyle
        }
        if (rec.listLevel === undefined) {
          delete rec.el.listLevel
        } else {
          rec.el.listLevel = rec.listLevel
        }
      }
    }
    applyForward()
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        applyForward()
        this.draw.render({ curIndex, isSetCursor })
      },
      applyBackward: () => {
        applyBackward()
        this.draw.render({ curIndex, isSetCursor })
      }
    })
    this.draw.markDirty(spanStart, spanEnd)
    this.draw.cancelScheduledRender()
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
  }

  public unsetList() {
    const isReadonly = this.draw.isReadonly()
    if (isReadonly) return
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return
    // 如果需要补换行符，走一次性手动 delta（同时捕获元素插入与属性删除）
    const elementList = this.draw.getElementList()
    const endElement = elementList[endIndex]
    let needZeroInsert = false
    let zeroInsertIndex = -1
    if (endElement.listId) {
      let start = endIndex + 1
      while (start < elementList.length) {
        const element = elementList[start]
        if (element.value === ZERO && !element.listWrap) break
        if (element.listId !== endElement.listId) {
          needZeroInsert = true
          zeroInsertIndex = start
          break
        }
        start++
      }
    }
    // 捕获变更前的所有状态
    const oldValues = changeElementList.map(el => ({
      el,
      listId: el.listId,
      listType: el.listType,
      listStyle: el.listStyle,
      listWrap: el.listWrap
    }))
    // 应用变更
    if (needZeroInsert) {
      elementList.splice(zeroInsertIndex, 0, { value: ZERO })
    }
    changeElementList.forEach(el => {
      delete el.listId
      delete el.listType
      delete el.listStyle
      delete el.listWrap
      delete el.listLevel
    })
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        if (needZeroInsert) {
          elementList.splice(zeroInsertIndex, 0, { value: ZERO })
        }
        for (const item of oldValues) {
          delete item.el.listId
          delete item.el.listType
          delete item.el.listStyle
          delete item.el.listWrap
        }
        this.draw.render({ curIndex, isSetCursor })
      },
      applyBackward: () => {
        if (needZeroInsert) {
          elementList.splice(zeroInsertIndex, 1)
        }
        for (const item of oldValues) {
          item.el.listId = item.listId
          item.el.listType = item.listType
          item.el.listStyle = item.listStyle
          if (item.listWrap !== undefined) item.el.listWrap = item.listWrap
        }
        this.draw.render({ curIndex, isSetCursor })
      }
    })
    this.draw.markDirty(startIndex, endIndex)
    this.draw.cancelScheduledRender()
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
  }

  public indent(): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    let mutated = false
    changeElementList.forEach(el => {
      const cur = el.listLevel ?? 1
      const next = Math.min(cur + 1, LIST_MAX_LEVEL)
      if (next !== cur) {
        el.listLevel = next
        mutated = true
      }
    })
    if (!mutated) return false
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.render({ curIndex, isSetCursor })
    return true
  }

  public setFormat(format: string | null): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    changeElementList.forEach(el => {
      if (format) {
        el.listFormat = format
      } else {
        delete el.listFormat
      }
    })
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.render({ curIndex, isSetCursor })
    return true
  }

  public outdent(): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    let mutated = false
    let needsExit = false
    changeElementList.forEach(el => {
      const cur = el.listLevel ?? 1
      if (cur > 1) {
        el.listLevel = cur - 1
        mutated = true
      } else {
        needsExit = true
      }
    })
    if (needsExit) {
      this.unsetList()
      return true
    }
    if (!mutated) return false
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.render({ curIndex, isSetCursor })
    return true
  }

  public computeListLayout(
    ctx: CanvasRenderingContext2D,
    elementList: IElement[]
  ): IListLayoutInfo {
    const glyphMap = computeListGlyphMap(elementList)
    const indicesByList = new Map<string, number[]>()
    glyphMap.forEach((_res, idx) => {
      const el = elementList[idx]
      if (!el?.listId) return
      const arr = indicesByList.get(el.listId) || []
      arr.push(idx)
      indicesByList.set(el.listId, arr)
    })
    const itemsByList = new Map<string, IElement[]>()
    for (const el of elementList) {
      if (!el.listId) continue
      const bucket = itemsByList.get(el.listId) || []
      bucket.push(el)
      itemsByList.set(el.listId, bucket)
    }
    const gutterByListId = new Map<string, number>()
    itemsByList.forEach((items, listId) => {
      const indices = indicesByList.get(listId) || []
      gutterByListId.set(
        listId,
        this.measureListGutter(ctx, items, glyphMap, indices)
      )
    })
    return { glyphMap, gutterByListId }
  }

  private measureListGutter(
    ctx: CanvasRenderingContext2D,
    items: IElement[],
    glyphMap: Map<number, IListGlyphResult>,
    indices: number[]
  ): number {
    const { scale, checkbox } = this.options
    const start = items[0]
    if (start.listStyle === ListStyle.CHECKBOX) {
      return (checkbox.width + this.LIST_GAP) * scale
    }
    if (start.listType === ListType.UL) {
      return this.UN_COUNT_STYLE_WIDTH * scale
    }
    if (!indices.length) return 0
    ctx.save()
    ctx.font = this.getListFontStyle(items, scale)
    let maxW = 0
    for (const idx of indices) {
      const g = glyphMap.get(idx)
      if (!g) continue
      const m = ctx.measureText(g.glyph)
      if (m.width > maxW) maxW = m.width
    }
    ctx.restore()
    return Math.ceil((maxW + this.LIST_GAP) * scale)
  }

  public getLevelIndent(level: number | undefined): number {
    const { scale, list } = this.options
    const lvl = Math.max(1, Math.min(level || 1, LIST_MAX_LEVEL))
    const arr = list?.levelIndents
    if (Array.isArray(arr) && arr.length > 0) {
      const idx = Math.min(lvl - 1, arr.length - 1)
      const px = Number(arr[idx]) || 0
      return px * scale
    }
    return (lvl - 1) * LIST_INDENT_STEP * scale
  }

  public applyStyle(style: IListStyle): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    if (!style?.levels?.length) return false
    const byLevel = new Map<number, (typeof style.levels)[number]>()
    for (const lvl of style.levels) byLevel.set(lvl.level, lvl)
    changeElementList.forEach(el => {
      const lvl = el.listLevel ?? 1
      const cfg = byLevel.get(lvl)
      if (!cfg) return
      if (cfg.format) el.listFormat = cfg.format
      if (cfg.numberStyle === 'bullet') {
        if (cfg.bulletChar) el.listBulletChar = cfg.bulletChar
      } else if (cfg.numberStyle) {
        el.listNumberStyle = cfg.numberStyle
      }
    })
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.render({ curIndex, isSetCursor })
    return true
  }

  public setLevel(level: number): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    const clamped = Math.max(1, Math.min(Math.floor(level), LIST_MAX_LEVEL))
    let mutated = false
    changeElementList.forEach(el => {
      if ((el.listLevel ?? 1) !== clamped) {
        el.listLevel = clamped
        mutated = true
      }
    })
    if (!mutated) return false
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.render({ curIndex, isSetCursor })
    return true
  }

  // Back-compat shim used by callers that only need gutter widths.
  public computeListStyle(
    ctx: CanvasRenderingContext2D,
    elementList: IElement[]
  ): Map<string, number> {
    return this.computeListLayout(ctx, elementList).gutterByListId
  }

  // Retained for legacy paths; new code should use computeListLayout.
  public getListStyleWidth(
    ctx: CanvasRenderingContext2D,
    listElementList: IElement[]
  ): number {
    const { scale, checkbox } = this.options
    const startElement = listElementList[0]
    if (
      startElement.listStyle &&
      startElement.listStyle !== ListStyle.DECIMAL
    ) {
      if (startElement.listStyle === ListStyle.CHECKBOX) {
        return (checkbox.width + this.LIST_GAP) * scale
      }
      return this.UN_COUNT_STYLE_WIDTH * scale
    }
    const count = listElementList.reduce((pre, cur) => {
      if (cur.value === ZERO) pre += 1
      return pre
    }, 0)
    if (!count) return 0
    ctx.save()
    ctx.font = this.getListFontStyle(listElementList, scale)
    const text = `${this.MEASURE_BASE_TEXT.repeat(
      String(count).length - 1 || 1
    )}${KeyMap.PERIOD}`
    const textMetrics = ctx.measureText(text)
    ctx.restore()
    return Math.ceil((textMetrics.width + this.LIST_GAP) * scale)
  }

  private findStyledElement(elementList: IElement[]): IElement {
    let styleElement = elementList[0]
    for (let i = 1; i < elementList.length; i++) {
      const element = elementList[i]
      if (element.font || element.size || element.bold || element.italic) {
        styleElement = element
        break
      }
    }
    return styleElement
  }

  private getListFontStyle(elementList: IElement[], scale: number): string {
    if (this.options.list.inheritStyle) {
      const styleElement = this.findStyledElement(elementList)
      return this.draw.getElementFont(styleElement, scale)
    } else {
      const { defaultFont, defaultSize } = this.options
      return `${defaultSize * scale}px ${defaultFont}`
    }
  }

  public drawListStyle(
    ctx: CanvasRenderingContext2D,
    row: IRow,
    position: IElementPosition
  ) {
    const { elementList, offsetX, ascent } = row
    const startElement = elementList[0]
    if (startElement.value !== ZERO || startElement.listWrap) return
    let tabWidth = 0
    const { defaultTabWidth, scale } = this.options
    for (let i = 1; i < elementList.length; i++) {
      const element = elementList[i]
      if (element?.type !== ElementType.TAB) break
      tabWidth += defaultTabWidth * scale
    }
    const {
      coordinate: {
        leftTop: [startX, startY]
      }
    } = position
    const levelIndent = this.getLevelIndent(row.listLevel)
    const x = startX - offsetX! + tabWidth + levelIndent
    const y = startY + ascent
    if (startElement.listStyle === ListStyle.CHECKBOX) {
      const { width, height, gap } = this.options.checkbox
      const checkboxRowElement: IRowElement = {
        ...startElement,
        checkbox: {
          value: !!startElement.checkbox?.value
        },
        metrics: {
          ...startElement.metrics,
          width: (width + gap * 2) * scale,
          height: height * scale
        }
      }
      this.draw.getCheckboxParticle().render({
        ctx,
        x: x - gap * scale,
        y,
        index: 0,
        row: {
          ...row,
          elementList: [checkboxRowElement, ...row.elementList]
        }
      })
      return
    }
    const text = row.listGlyph || ''
    if (!text) return
    ctx.save()
    ctx.font = this.getListFontStyle(elementList, scale)
    ctx.fillText(text, x, y)
    ctx.restore()
  }
}
