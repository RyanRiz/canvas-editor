import { ZERO } from '../../../dataset/constant/Common'
import { TEXTLIKE_ELEMENT_TYPE } from '../../../dataset/constant/Element'
import { LIST_INDENT_STEP } from '../../../dataset/constant/listLevel'
import { ElementType } from '../../../dataset/enum/Element'

const LIST_ROW_MARGIN = 1.25
import { KeyMap } from '../../../dataset/enum/KeyMap'
import {
  ListStyle,
  ListType,
  OlStyle,
  UlStyle
} from '../../../dataset/enum/List'
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
import {
  computeListGlyphMap,
  getMultilevelTemplate
} from '../../../utils/listNumbering'
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

  private currentUnorderedStyle: UlStyle = UlStyle.DISC
  private currentOrderedStyle: OlStyle = OlStyle.DECIMAL

  constructor(draw: Draw) {
    this.draw = draw
    this.range = draw.getRange()
    this.options = draw.getOptions()
  }

  public setList(
    listType: ListType | null,
    listStyle?: ListStyle,
    checklistStyle?: 'standard' | 'plain'
  ) {
    const isReadonly = this.draw.isReadonly()
    if (isReadonly) return
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    // Session memory: track the last-chosen style per list family so plain
    // toolbar clicks always apply the same style uniformly across scope.
    if (listStyle !== undefined) {
      if (listType === ListType.UL) {
        this.currentUnorderedStyle = listStyle as unknown as UlStyle
      } else if (listType === ListType.OL) {
        this.currentOrderedStyle = listStyle as unknown as OlStyle
      }
    }
    // Resolve effective style: explicit arg wins, otherwise session default.
    const effectiveStyle =
      listStyle ??
      (listType === ListType.UL
        ? (this.currentUnorderedStyle as unknown as ListStyle)
        : listType === ListType.OL
          ? (this.currentOrderedStyle as unknown as ListStyle)
          : undefined)
    // Word-parity collapsed-cursor scope: when the user clicks a list-type
    // toggle with a collapsed cursor on a multi-level list paragraph,
    // restrict scope to paragraphs at the SAME listLevel as the cursor.
    // Without this, parent (level 1) + child (level 2) paragraphs sharing
    // one listId all flip, dropping the parent's custom markers.
    const cursorElForScope = this.draw.getElementList()[endIndex]
    const cursorLevel = cursorElForScope?.listLevel ?? 1
    const isCollapsedLevelScope =
      startIndex === endIndex && !!cursorElForScope?.listId
    let changeElementList = this.range.getRangeParagraphElementList()
    if (!changeElementList || !changeElementList.length) return
    if (isCollapsedLevelScope) {
      const filtered = changeElementList.filter(
        el => !el.listId || (el.listLevel ?? 1) === cursorLevel
      )
      if (filtered.length) changeElementList = filtered
    }
    // Skip toggle-off when explicitly changing checklist style variant
    const isUnsetList =
      !checklistStyle &&
      changeElementList.find(
        el => el.listType === listType && el.listStyle === effectiveStyle
      )
    if (isUnsetList || !listType) {
      this.unsetList()
      return
    }
    // Detect checklist→non-checklist conversion early so the neighbour
    // expansion loop (below) can force isSelected on all paragraphs.
    const isChecklistSource =
      changeElementList.some(
        el => el.listStyle === ListStyle.CHECKBOX && el.listId
      ) &&
      effectiveStyle !== ListStyle.CHECKBOX &&
      listType !== null
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
      mainIndex: number
      listId: string | undefined
      listType: ListType | undefined
      listStyle: ListStyle | undefined
      listLevel: number | undefined
      checklistStyle: 'standard' | 'plain' | undefined
      isSelected: boolean
    }
    const unifyRecords: UnifyRecord[] = []
    const isCollapsed = startIndex === endIndex
    // Capture element positions by index, NOT by reference.
    // _submitSnapshotHistory restores via `this.elementList = deepClone(...)`,
    // which invalidates any captured element reference. Re-resolving via
    // index at apply-time survives snapshot restore (indices stay stable).
    for (const el of changeElementList) {
      const idx = mainList.indexOf(el)
      if (idx < 0) continue
      unifyRecords.push({
        mainIndex: idx,
        listId: el.listId,
        listType: el.listType,
        listStyle: el.listStyle,
        listLevel: el.listLevel,
        checklistStyle: el.checklistStyle,
        isSelected: true
      })
    }
    for (let p = spanStart; p <= spanEnd && p < mainList.length; p++) {
      const el = mainList[p]
      if (!el.listId) continue
      if (changeSet.has(el)) continue
      // Neighbour inclusion under collapsed-cursor scope: only flip
      // paragraphs at the SAME listLevel as the cursor. Level-mismatched
      // neighbours stay in the unification (one listId, continuous numbering)
      // but keep their own listType/listStyle.
      const sameLevel =
        !isCollapsedLevelScope || (el.listLevel ?? 1) === cursorLevel
      unifyRecords.push({
        mainIndex: p,
        listId: el.listId,
        listType: el.listType,
        listStyle: el.listStyle,
        listLevel: el.listLevel,
        checklistStyle: el.checklistStyle,
        isSelected: isChecklistSource ? true : isCollapsed && sameLevel
      })
    }
    const draw = this.draw
    const requestedChecklistStyle = checklistStyle
    const checklistCleanup: Array<{
      zeroIndex: number
      textIndices: Array<{
        index: number
        strikeout: boolean | undefined
        color: string | undefined
      }>
    }> = []
    if (isChecklistSource) {
      const cleanupStart = seedListId ? spanStart : firstChangeIdx
      const cleanupEnd = seedListId ? spanEnd : lastChangeIdx
      for (let p = cleanupStart; p <= cleanupEnd && p < mainList.length; p++) {
        const el = mainList[p]
        if (el.checkbox?.value && el.listStyle === ListStyle.CHECKBOX) {
          const textEntries: Array<{
            index: number
            strikeout: boolean | undefined
            color: string | undefined
          }> = []
          let t = p + 1
          while (t < mainList.length && mainList[t].value !== ZERO) {
            const tt = mainList[t].type
            if (!tt || TEXTLIKE_ELEMENT_TYPE.includes(tt)) {
              textEntries.push({
                index: t,
                strikeout: mainList[t].strikeout,
                color: mainList[t].color
              })
            }
            t++
          }
          checklistCleanup.push({ zeroIndex: p, textIndices: textEntries })
        }
      }
    }
    const applyForward = () => {
      const list = draw.getElementList()
      for (const rec of unifyRecords) {
        const el = list[rec.mainIndex]
        if (!el) continue
        el.listId = unifiedListId
        if (rec.isSelected) {
          el.listType = listType
          el.listStyle = effectiveStyle
          // Preserve listLevel when the paragraph was already in a list
          // (changing TYPE shouldn't outdent). Default to 1 only when
          // entering a list from plain text. Mirrors Word's "toggling list
          // type keeps multi-level indent" behaviour.
          if (!rec.listId) {
            el.listLevel = 1
            el.rowMargin = LIST_ROW_MARGIN
          } else if (rec.listLevel !== undefined) {
            el.listLevel = rec.listLevel
          }
          // Apply checklistStyle when entering checklist mode
          if (
            effectiveStyle === ListStyle.CHECKBOX &&
            requestedChecklistStyle !== undefined
          ) {
            el.checklistStyle = requestedChecklistStyle
          }
        }
      }
      // Issue 4: clear checklist-derived styling on conversion
      for (const cs of checklistCleanup) {
        const zero = list[cs.zeroIndex]
        if (zero) {
          delete zero.checkbox
          delete zero.checklistStyle
        }
        for (const t of cs.textIndices) {
          const te = list[t.index]
          if (te) {
            delete te.strikeout
            delete te.color
          }
        }
      }
      if (isChecklistSource) {
        for (const rec of unifyRecords) {
          if (rec.isSelected) {
            const el = list[rec.mainIndex]
            if (el) delete el.checklistStyle
          }
        }
      }
    }
    const applyBackward = () => {
      const list = draw.getElementList()
      for (const rec of unifyRecords) {
        const el = list[rec.mainIndex]
        if (!el) continue
        if (rec.listId === undefined) {
          delete el.listId
          delete el.rowMargin
        } else {
          el.listId = rec.listId
        }
        if (rec.listType === undefined) {
          delete el.listType
        } else {
          el.listType = rec.listType
        }
        if (rec.listStyle === undefined) {
          delete el.listStyle
        } else {
          el.listStyle = rec.listStyle
        }
        if (rec.listLevel === undefined) {
          delete el.listLevel
        } else {
          el.listLevel = rec.listLevel
        }
        if (rec.checklistStyle === undefined) {
          delete el.checklistStyle
        } else {
          el.checklistStyle = rec.checklistStyle
        }
      }
      // Issue 4: restore checklist-derived styling on undo
      for (const cs of checklistCleanup) {
        const zero = list[cs.zeroIndex]
        if (zero) {
          zero.checkbox = { value: true }
        }
        for (const t of cs.textIndices) {
          const te = list[t.index]
          if (te) {
            if (t.strikeout !== undefined) te.strikeout = t.strikeout
            else delete te.strikeout
            if (t.color !== undefined) te.color = t.color
            else delete te.color
          }
        }
      }
    }
    applyForward()
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    const dirtySpanSetList = { start: spanStart, end: spanEnd }
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        applyForward()
        this.draw.markDirty(dirtySpanSetList.start, dirtySpanSetList.end)
        this.draw.invalidatePaintCache()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        applyBackward()
        this.draw.markDirty(dirtySpanSetList.start, dirtySpanSetList.end)
        this.draw.invalidatePaintCache()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    this.draw.markDirty(spanStart, spanEnd)
    this.draw.cancelScheduledRender()
    this.draw.invalidateListLayoutCache()
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
  }

  public unsetList() {
    const isReadonly = this.draw.isReadonly()
    if (isReadonly) return
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    let changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return
    // Word-parity collapsed-cursor scope: restrict to same listLevel.
    const ulCursorEl = this.draw.getElementList()[endIndex]
    const ulCursorLevel = ulCursorEl?.listLevel ?? 1
    const ulIsCollapsedLevelScope =
      startIndex === endIndex && !!ulCursorEl?.listId
    if (ulIsCollapsedLevelScope) {
      const filtered = changeElementList.filter(
        el => (el.listLevel ?? 1) === ulCursorLevel
      )
      if (filtered.length) changeElementList = filtered
    }
    // Word parity: when the selection is collapsed and the cursor sits
    // inside a list, remove the list from the ENTIRE contiguous block
    // (same listId), not just the one paragraph the cursor touches.
    // Multi-level: only paragraphs at the SAME listLevel are unset.
    const isCollapsed = startIndex === endIndex
    let didExpandBlock = false
    if (isCollapsed && changeElementList[0]?.listId) {
      const blockListId = changeElementList[0].listId
      const mainList = this.draw.getElementList()
      let blockStart = mainList.indexOf(changeElementList[0])
      while (
        blockStart > 0 &&
        mainList[blockStart - 1]?.listId === blockListId
      ) {
        blockStart--
      }
      let blockEnd = mainList.indexOf(
        changeElementList[changeElementList.length - 1]
      )
      while (
        blockEnd < mainList.length - 1 &&
        mainList[blockEnd + 1]?.listId === blockListId
      ) {
        blockEnd++
      }
      const expanded: IElement[] = []
      for (let i = blockStart; i <= blockEnd; i++) {
        const el = mainList[i]
        if (el.listId !== blockListId) continue
        if (ulIsCollapsedLevelScope && (el.listLevel ?? 1) !== ulCursorLevel) {
          continue
        }
        expanded.push(el)
      }
      if (expanded.length > changeElementList.length) {
        changeElementList = expanded
        didExpandBlock = true
      }
    }
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
    // Capture element positions by index, NOT by reference.
    // _submitSnapshotHistory replaces this.elementList via deepClone, which
    // invalidates element refs and the captured `elementList` variable too.
    const oldValues = changeElementList
      .map(el => ({
        mainIndex: elementList.indexOf(el),
        listId: el.listId,
        listType: el.listType,
        listStyle: el.listStyle,
        listWrap: el.listWrap,
        listLevel: el.listLevel
      }))
      .filter(v => v.mainIndex >= 0)
    // Issue 4: when unsetting a checklist, clear checklist-derived text
    // styling (strikethrough, muted color) and checked state.
    const isChecklistUnset = changeElementList.some(
      el => el.listStyle === ListStyle.CHECKBOX && el.listId
    )
    const checklistCleanup: Array<{
      zeroIndex: number
      textIndices: Array<{
        index: number
        strikeout: boolean | undefined
        color: string | undefined
      }>
    }> = []
    if (isChecklistUnset) {
      const clMainList = this.draw.getElementList()
      for (const el of changeElementList) {
        if (el.checkbox?.value && el.listStyle === ListStyle.CHECKBOX) {
          const zeroIdx = clMainList.indexOf(el)
          if (zeroIdx < 0) continue
          const textEntries: Array<{
            index: number
            strikeout: boolean | undefined
            color: string | undefined
          }> = []
          let t = zeroIdx + 1
          while (t < clMainList.length && clMainList[t].value !== ZERO) {
            const tt = clMainList[t].type
            if (!tt || TEXTLIKE_ELEMENT_TYPE.includes(tt)) {
              textEntries.push({
                index: t,
                strikeout: clMainList[t].strikeout,
                color: clMainList[t].color
              })
            }
            t++
          }
          checklistCleanup.push({
            zeroIndex: zeroIdx,
            textIndices: textEntries
          })
        }
      }
    }
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
    // Issue 4: clear checklist-derived styling immediately
    for (const cs of checklistCleanup) {
      const zero = elementList[cs.zeroIndex]
      if (zero) {
        delete zero.checkbox
        delete zero.checklistStyle
      }
      for (const t of cs.textIndices) {
        const te = elementList[t.index]
        if (te) {
          delete te.strikeout
          delete te.color
        }
      }
    }
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    // Compute dirty range — expand to full block when we broadened scope
    let dirtyStart = startIndex
    let dirtyEnd = endIndex
    if (didExpandBlock && changeElementList.length) {
      dirtyStart = elementList.indexOf(changeElementList[0])
      dirtyEnd = elementList.indexOf(
        changeElementList[changeElementList.length - 1]
      )
      if (dirtyStart < 0) dirtyStart = startIndex
      if (dirtyEnd < 0) dirtyEnd = endIndex
    }
    const usDirtySpan = { start: dirtyStart, end: dirtyEnd }
    const draw = this.draw
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        const list = draw.getElementList()
        // Property writes BEFORE splice so pre-splice indices stay valid.
        for (const item of oldValues) {
          const el = list[item.mainIndex]
          if (!el) continue
          delete el.listId
          delete el.listType
          delete el.listStyle
          delete el.listWrap
          delete el.listLevel
        }
        // Issue 4: clear checklist-derived styling
        for (const cs of checklistCleanup) {
          const zero = list[cs.zeroIndex]
          if (zero) {
            delete zero.checkbox
            delete zero.checklistStyle
          }
          for (const t of cs.textIndices) {
            const te = list[t.index]
            if (te) {
              delete te.strikeout
              delete te.color
            }
          }
        }
        if (needZeroInsert) {
          list.splice(zeroInsertIndex, 0, { value: ZERO })
        }
        draw.markDirty(usDirtySpan.start, usDirtySpan.end)
        draw.invalidatePaintCache()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        const list = draw.getElementList()
        if (needZeroInsert) {
          list.splice(zeroInsertIndex, 1)
        }
        for (const item of oldValues) {
          const el = list[item.mainIndex]
          if (!el) continue
          el.listId = item.listId
          el.listType = item.listType
          el.listStyle = item.listStyle
          if (item.listWrap !== undefined) el.listWrap = item.listWrap
          if (item.listLevel !== undefined) el.listLevel = item.listLevel
        }
        // Issue 4: restore checklist-derived styling
        for (const cs of checklistCleanup) {
          const zero = list[cs.zeroIndex]
          if (zero) {
            zero.checkbox = { value: true }
          }
          for (const t of cs.textIndices) {
            const te = list[t.index]
            if (te) {
              if (t.strikeout !== undefined) te.strikeout = t.strikeout
              else delete te.strikeout
              if (t.color !== undefined) te.color = t.color
              else delete te.color
            }
          }
        }
        draw.markDirty(usDirtySpan.start, usDirtySpan.end)
        draw.invalidatePaintCache()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    this.draw.markDirty(usDirtySpan.start, usDirtySpan.end)
    this.draw.cancelScheduledRender()
    this.draw.invalidateListLayoutCache()
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
    // Capture old levels for undo
    const mainList = this.draw.getElementList()
    const oldLevels = changeElementList
      .map(el => ({
        mainIndex: mainList.indexOf(el),
        listLevel: el.listLevel
      }))
      .filter(v => v.mainIndex >= 0)
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
    const spanStart = oldLevels[0]?.mainIndex ?? startIndex
    const spanEnd = oldLevels[oldLevels.length - 1]?.mainIndex ?? endIndex
    const draw = this.draw
    draw.getHistoryManager().executeDelta({
      applyForward: () => {
        for (const item of oldLevels) {
          const el = draw.getElementList()[item.mainIndex]
          if (!el) continue
          el.listLevel = Math.min((el.listLevel ?? 1) + 1, LIST_MAX_LEVEL)
        }
        draw.markDirty(spanStart, spanEnd)
        draw.invalidatePaintCache()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
        draw.ruler?.invalidateActiveFramePaintKey()
        draw.ruler?.render()
      },
      applyBackward: () => {
        for (const item of oldLevels) {
          const el = draw.getElementList()[item.mainIndex]
          if (!el) continue
          if (item.listLevel === undefined) delete el.listLevel
          else el.listLevel = item.listLevel
        }
        draw.markDirty(spanStart, spanEnd)
        draw.invalidatePaintCache()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
        draw.ruler?.invalidateActiveFramePaintKey()
        draw.ruler?.render()
      }
    })
    draw.markDirty(spanStart, spanEnd)
    draw.invalidatePaintCache()
    draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
    draw.ruler?.render()
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
    // Capture old levels BEFORE mutation
    const mainList = this.draw.getElementList()
    const oldLevels = changeElementList
      .map(el => ({
        mainIndex: mainList.indexOf(el),
        listLevel: el.listLevel
      }))
      .filter(v => v.mainIndex >= 0)
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
    // oldLevels was captured above, before mutation
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    const spanStart = oldLevels[0]?.mainIndex ?? startIndex
    const spanEnd = oldLevels[oldLevels.length - 1]?.mainIndex ?? endIndex
    const draw = this.draw
    draw.getHistoryManager().executeDelta({
      applyForward: () => {
        for (const item of oldLevels) {
          const el = draw.getElementList()[item.mainIndex]
          if (!el) continue
          const cur = el.listLevel ?? 1
          if (cur > 1) el.listLevel = cur - 1
        }
        draw.markDirty(spanStart, spanEnd)
        draw.invalidatePaintCache()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
        draw.ruler?.invalidateActiveFramePaintKey()
        draw.ruler?.render()
      },
      applyBackward: () => {
        for (const item of oldLevels) {
          const el = draw.getElementList()[item.mainIndex]
          if (!el) continue
          if (item.listLevel === undefined) delete el.listLevel
          else el.listLevel = item.listLevel
        }
        draw.markDirty(spanStart, spanEnd)
        draw.invalidatePaintCache()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
        draw.ruler?.invalidateActiveFramePaintKey()
        draw.ruler?.render()
      }
    })
    draw.markDirty(spanStart, spanEnd)
    draw.invalidatePaintCache()
    draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
    draw.ruler?.render()
    return true
  }

  /**
   * Combined list toggle that sets the list type AND applies a style config
   * within a single undo entry. Calling setList() then applyStyle() separately
   * pushes two deltas — this method produces exactly one.
   */
  public setListWithStyle(
    listType: ListType | null,
    listStyle?: ListStyle,
    styleConfig?: IListStyle
  ) {
    if (this.draw.isReadonly()) return
    // ---- Phase 1: setList (same logic as public setList) ----
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    if (listStyle !== undefined) {
      if (listType === ListType.UL) {
        this.currentUnorderedStyle = listStyle as unknown as UlStyle
      } else if (listType === ListType.OL) {
        this.currentOrderedStyle = listStyle as unknown as OlStyle
      }
    }
    const effectiveStyle =
      listStyle ??
      (listType === ListType.UL
        ? (this.currentUnorderedStyle as unknown as ListStyle)
        : listType === ListType.OL
          ? (this.currentOrderedStyle as unknown as ListStyle)
          : undefined)
    let changeElementList = this.range.getRangeParagraphElementList()
    if (!changeElementList || !changeElementList.length) return
    // Word-parity collapsed-cursor scope: restrict to same listLevel.
    const mainList = this.draw.getElementList()
    const lwsCursorEl = mainList[endIndex]
    const lwsCursorLevel = lwsCursorEl?.listLevel ?? 1
    const lwsIsCollapsedLevelScope =
      startIndex === endIndex && !!lwsCursorEl?.listId
    if (lwsIsCollapsedLevelScope) {
      const filtered = changeElementList.filter(
        el => !el.listId || (el.listLevel ?? 1) === lwsCursorLevel
      )
      if (filtered.length) changeElementList = filtered
    }
    // Only toggle-off when no explicit styleConfig was provided (plain toggle).
    // When styleConfig is present (dropdown pick), the user wants to change
    // the style — not toggle the list off — even if type+style happen to match.
    const isUnsetList =
      !styleConfig &&
      changeElementList.find(
        el => el.listType === listType && el.listStyle === effectiveStyle
      )
    if (isUnsetList || !listType) {
      this.unsetList()
      return
    }
    // Word parity: when the selection is collapsed and the cursor sits in
    // an existing list block, expand changeElementList to cover the entire
    // contiguous listId block — so the style config (bullet char, format)
    // gets applied uniformly across the whole logical list, not just the
    // cursor paragraph. Range selections only affect their highlighted
    // paragraphs (no expansion). Restricted to same listLevel under
    // collapsed-cursor scope (see lwsIsCollapsedLevelScope above).
    {
      const isCollapsedCheck = startIndex === endIndex
      const cursorListId = changeElementList[0]?.listId
      if (isCollapsedCheck && cursorListId) {
        let bStart = mainList.indexOf(changeElementList[0])
        while (bStart > 0 && mainList[bStart - 1]?.listId === cursorListId) {
          bStart--
        }
        let bEnd = mainList.indexOf(
          changeElementList[changeElementList.length - 1]
        )
        while (
          bEnd < mainList.length - 1 &&
          mainList[bEnd + 1]?.listId === cursorListId
        ) {
          bEnd++
        }
        const expanded: IElement[] = []
        for (let i = bStart; i <= bEnd; i++) {
          const el = mainList[i]
          if (el.listId !== cursorListId) continue
          if (
            lwsIsCollapsedLevelScope &&
            (el.listLevel ?? 1) !== lwsCursorLevel
          ) {
            continue
          }
          expanded.push(el)
        }
        if (expanded.length > changeElementList.length) {
          changeElementList = expanded
        }
      }
    }
    const firstChangeIdx = mainList.indexOf(changeElementList[0])
    const lastChangeIdx = mainList.indexOf(
      changeElementList[changeElementList.length - 1]
    )
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
    // Issue 4: when converting FROM a checklist to another list type, clear
    // checklist-derived text styling (strikethrough, muted color) and checked
    // state so the styling doesn't leak into the new non-checklist list.
    const isChecklistSourceSetListWithStyle =
      changeElementList.some(
        el => el.listStyle === ListStyle.CHECKBOX && el.listId
      ) &&
      effectiveStyle !== ListStyle.CHECKBOX &&
      listType !== null
    const checklistCleanupSetListWithStyle: Array<{
      zeroIndex: number
      textIndices: Array<{
        index: number
        strikeout: boolean | undefined
        color: string | undefined
      }>
    }> = []
    if (isChecklistSourceSetListWithStyle) {
      const cleanupStart = seedListId ? spanStart : firstChangeIdx
      const cleanupEnd = seedListId ? spanEnd : lastChangeIdx
      for (let p = cleanupStart; p <= cleanupEnd && p < mainList.length; p++) {
        const el = mainList[p]
        if (el.checkbox?.value && el.listStyle === ListStyle.CHECKBOX) {
          const textEntries: Array<{
            index: number
            strikeout: boolean | undefined
            color: string | undefined
          }> = []
          let t = p + 1
          while (t < mainList.length && mainList[t].value !== ZERO) {
            const tt = mainList[t].type
            if (!tt || TEXTLIKE_ELEMENT_TYPE.includes(tt)) {
              textEntries.push({
                index: t,
                strikeout: mainList[t].strikeout,
                color: mainList[t].color
              })
            }
            t++
          }
          checklistCleanupSetListWithStyle.push({
            zeroIndex: p,
            textIndices: textEntries
          })
        }
      }
    }
    type UnifyRecord = {
      mainIndex: number
      listId: string | undefined
      listType: ListType | undefined
      listStyle: ListStyle | undefined
      listLevel: number | undefined
      isSelected: boolean
    }
    const unifyRecords: UnifyRecord[] = []
    const isCollapsed = startIndex === endIndex
    for (const el of changeElementList) {
      const idx = mainList.indexOf(el)
      if (idx < 0) continue
      unifyRecords.push({
        mainIndex: idx,
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
      // Neighbour inclusion under collapsed-cursor scope: only flip
      // paragraphs at the SAME listLevel as the cursor.
      const sameLevel =
        !lwsIsCollapsedLevelScope || (el.listLevel ?? 1) === lwsCursorLevel
      unifyRecords.push({
        mainIndex: p,
        listId: el.listId,
        listType: el.listType,
        listStyle: el.listStyle,
        listLevel: el.listLevel,
        // When converting FROM checklist, force all neighbours to be
        // selected so the entire block changes list type uniformly.
        isSelected: isChecklistSourceSetListWithStyle
          ? true
          : isCollapsed && sameLevel
      })
    }

    // ---- Phase 2: style-config capture (same logic as applyStyle) ----
    const byLevel = styleConfig?.levels?.length
      ? new Map<number, (typeof styleConfig.levels)[number]>()
      : null
    if (byLevel) {
      for (const lvl of styleConfig!.levels) byLevel.set(lvl.level, lvl)
    }
    // When cursor is collapsed, apply style config (bullet char, number style)
    // to the entire contiguous list block, not just the cursor's paragraph.
    // Mirrors the block-expansion pattern in applyStyle().
    // Critical: respects `lwsIsCollapsedLevelScope` so the style config does
    // NOT leak onto out-of-level paragraphs (multi-level scope correctness).
    // Without this filter, level-1 parents would receive level-1's cfg fields
    // (listFormat / listBulletChar) stamped on top of their custom format,
    // corrupting the parent list's markers.
    if (isCollapsed && byLevel) {
      const expanded: IElement[] = []
      for (let p = spanStart; p <= spanEnd && p < mainList.length; p++) {
        const el = mainList[p]
        if (!el.listId) continue
        if (
          lwsIsCollapsedLevelScope &&
          (el.listLevel ?? 1) !== lwsCursorLevel
        ) {
          continue
        }
        expanded.push(el)
      }
      if (expanded.length > changeElementList.length) {
        changeElementList = expanded
      }
    }
    // Word multi-level template: when styleConfig.id matches a registered
    // template, treat this as a template apply — stamp listTemplateId on each
    // paragraph and clear per-element format/bulletChar/numberStyle so the
    // render-time template lookup wins on every level.
    const isTemplateSetListWithStyle =
      !!styleConfig?.id && !!getMultilevelTemplate(styleConfig.id)
    const styleOldValues = byLevel
      ? changeElementList
          .map(el => ({
            mainIndex: mainList.indexOf(el),
            listFormat: el.listFormat,
            listBulletChar: el.listBulletChar,
            listNumberStyle: el.listNumberStyle,
            listTemplateId: el.listTemplateId
          }))
          .filter(v => v.mainIndex >= 0)
      : []

    // ---- Combined apply ----
    const draw = this.draw
    const applyForwardCombined = () => {
      const list = draw.getElementList()
      for (const rec of unifyRecords) {
        const el = list[rec.mainIndex]
        if (!el) continue
        el.listId = unifiedListId
        if (rec.isSelected) {
          el.listType = listType
          el.listStyle = effectiveStyle
          // Preserve listLevel when the paragraph was already in a list —
          // toggling list TYPE must not outdent multi-level items. Defaults
          // to 1 only when entering a list from plain text.
          if (!rec.listId) {
            el.listLevel = 1
            el.rowMargin = LIST_ROW_MARGIN
          } else if (rec.listLevel !== undefined) {
            el.listLevel = rec.listLevel
          }
        }
      }
      if (byLevel) {
        for (const item of styleOldValues) {
          const el = list[item.mainIndex]
          if (!el) continue
          if (isTemplateSetListWithStyle && styleConfig?.id) {
            el.listTemplateId = styleConfig.id
            // Clear per-element fields so render-time template lookup wins
            // on every level — Tab cascade depends on these NOT being set.
            delete el.listFormat
            delete el.listBulletChar
            delete el.listNumberStyle
            continue
          }
          const lvl = el.listLevel ?? 1
          const cfg = byLevel.get(lvl)
          if (!cfg) continue
          if (cfg.format) el.listFormat = cfg.format
          if (cfg.numberStyle === 'bullet') {
            if (cfg.bulletChar) {
              el.listBulletChar = cfg.bulletChar
            }
          } else if (cfg.numberStyle) {
            el.listNumberStyle = cfg.numberStyle
          }
        }
      }
      // Issue 4: clear checklist-derived styling on conversion
      for (const cs of checklistCleanupSetListWithStyle) {
        const zero = list[cs.zeroIndex]
        if (zero) {
          delete zero.checkbox
          delete zero.checklistStyle
        }
        for (const t of cs.textIndices) {
          const te = list[t.index]
          if (te) {
            delete te.strikeout
            delete te.color
          }
        }
      }
      if (isChecklistSourceSetListWithStyle) {
        for (const rec of unifyRecords) {
          if (rec.isSelected) {
            const el = list[rec.mainIndex]
            if (el) delete el.checklistStyle
          }
        }
      }
    }

    const applyBackwardCombined = () => {
      const list = draw.getElementList()
      for (const rec of unifyRecords) {
        const el = list[rec.mainIndex]
        if (!el) continue
        if (rec.listId === undefined) {
          delete el.listId
        } else {
          el.listId = rec.listId
        }
        if (rec.listType === undefined) {
          delete el.listType
        } else {
          el.listType = rec.listType
        }
        if (rec.listStyle === undefined) {
          delete el.listStyle
        } else {
          el.listStyle = rec.listStyle
        }
        if (rec.listLevel === undefined) {
          delete el.listLevel
        } else {
          el.listLevel = rec.listLevel
        }
      }
      for (const item of styleOldValues) {
        const el = list[item.mainIndex]
        if (!el) continue
        if (item.listFormat === undefined) {
          delete el.listFormat
        } else {
          el.listFormat = item.listFormat
        }
        if (item.listBulletChar === undefined) {
          delete el.listBulletChar
        } else {
          el.listBulletChar = item.listBulletChar
        }
        if (item.listNumberStyle === undefined) {
          delete el.listNumberStyle
        } else {
          el.listNumberStyle = item.listNumberStyle
        }
        if (item.listTemplateId === undefined) {
          delete el.listTemplateId
        } else {
          el.listTemplateId = item.listTemplateId
        }
      }
      // Issue 4: restore checklist-derived styling on undo
      for (const cs of checklistCleanupSetListWithStyle) {
        const zero = list[cs.zeroIndex]
        if (zero) {
          zero.checkbox = { value: true }
        }
        for (const t of cs.textIndices) {
          const te = list[t.index]
          if (te) {
            if (t.strikeout !== undefined) te.strikeout = t.strikeout
            else delete te.strikeout
            if (t.color !== undefined) te.color = t.color
            else delete te.color
          }
        }
      }
    }

    applyForwardCombined()
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    const dirtySpanSLWS = { start: spanStart, end: spanEnd }
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        applyForwardCombined()
        this.draw.markDirty(dirtySpanSLWS.start, dirtySpanSLWS.end)
        this.draw.invalidatePaintCache()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        applyBackwardCombined()
        this.draw.markDirty(dirtySpanSLWS.start, dirtySpanSLWS.end)
        this.draw.invalidatePaintCache()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    this.draw.markDirty(spanStart, spanEnd)
    this.draw.cancelScheduledRender()
    this.draw.invalidateListLayoutCache()
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
  }

  public computeListLayout(
    ctx: CanvasRenderingContext2D,
    elementList: IElement[]
  ): IListLayoutInfo {
    // Fast path: skip O(N) glyph/gutter scans when doc has no list elements.
    let hasList = false
    for (let i = 0; i < elementList.length; i++) {
      if (elementList[i].listId) {
        hasList = true
        break
      }
    }
    if (!hasList) {
      return { glyphMap: new Map(), gutterByListId: new Map() }
    }
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
    let changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    if (!style?.levels?.length) return false
    // Word-parity collapsed-cursor scope: restrict style-config stamping
    // to paragraphs at the SAME listLevel as the cursor. Without this filter
    // a level-2 child apply would stamp level-1's cfg.format / cfg.bulletChar
    // onto the surrounding level-1 parents.
    const asCursorEl = this.draw.getElementList()[endIndex]
    const asCursorLevel = asCursorEl?.listLevel ?? 1
    const asIsCollapsedLevelScope =
      startIndex === endIndex && !!asCursorEl?.listId
    if (asIsCollapsedLevelScope) {
      const filtered = changeElementList.filter(
        el => (el.listLevel ?? 1) === asCursorLevel
      )
      if (filtered.length) changeElementList = filtered
    }
    // Word parity: when the selection is collapsed, apply the style
    // config to the entire contiguous listId block — same expansion
    // pattern used by setList() and unsetList(). Without this, the
    // cursor paragraph gets properties (e.g. listBulletChar) that
    // neighbor paragraphs lack, causing divergent glyph rendering.
    // Level-filtered when collapsed-cursor-scope applies (multi-level).
    const isCollapsed = startIndex === endIndex
    if (isCollapsed && changeElementList[0]?.listId) {
      const blockListId = changeElementList[0].listId
      const mainList = this.draw.getElementList()
      let blockStart = mainList.indexOf(changeElementList[0])
      while (
        blockStart > 0 &&
        mainList[blockStart - 1]?.listId === blockListId
      ) {
        blockStart--
      }
      let blockEnd = mainList.indexOf(
        changeElementList[changeElementList.length - 1]
      )
      while (
        blockEnd < mainList.length - 1 &&
        mainList[blockEnd + 1]?.listId === blockListId
      ) {
        blockEnd++
      }
      const expanded: IElement[] = []
      for (let i = blockStart; i <= blockEnd; i++) {
        const el = mainList[i]
        if (el.listId !== blockListId) continue
        if (asIsCollapsedLevelScope && (el.listLevel ?? 1) !== asCursorLevel) {
          continue
        }
        expanded.push(el)
      }
      if (expanded.length > changeElementList.length) {
        changeElementList = expanded
      }
    }
    // Word multi-level template: when `style.id` matches a template registered
    // via `registerMultilevelTemplate`, stamp `listTemplateId` on every
    // paragraph and CLEAR per-element list fields. Render-time template
    // lookup in `computeListGlyphMap` then cascades the glyph per listLevel
    // without further mutation on Tab.
    const isTemplate = !!getMultilevelTemplate(style.id)
    const byLevel = new Map<number, (typeof style.levels)[number]>()
    for (const lvl of style.levels) byLevel.set(lvl.level, lvl)
    // Capture by index, not by reference, so deltas survive snapshot restore
    // (deepClone of this.elementList).
    const mainListForApply = this.draw.getElementList()
    const oldValues = changeElementList
      .map(el => ({
        mainIndex: mainListForApply.indexOf(el),
        listFormat: el.listFormat,
        listBulletChar: el.listBulletChar,
        listNumberStyle: el.listNumberStyle,
        listTemplateId: el.listTemplateId
      }))
      .filter(v => v.mainIndex >= 0)
    const draw = this.draw
    const applyForwardStyle = () => {
      const list = draw.getElementList()
      for (const item of oldValues) {
        const el = list[item.mainIndex]
        if (!el) continue
        if (isTemplate) {
          el.listTemplateId = style.id
          // Clear per-element fields so template render-time lookup wins
          // on every level (Tab cascade depends on these NOT being set).
          delete el.listFormat
          delete el.listBulletChar
          delete el.listNumberStyle
          continue
        }
        const lvl = el.listLevel ?? 1
        const cfg = byLevel.get(lvl)
        if (!cfg) continue
        if (cfg.format) el.listFormat = cfg.format
        if (cfg.numberStyle === 'bullet') {
          if (cfg.bulletChar) el.listBulletChar = cfg.bulletChar
        } else if (cfg.numberStyle) {
          el.listNumberStyle = cfg.numberStyle
        }
      }
    }
    const applyBackwardStyle = () => {
      const list = draw.getElementList()
      for (const item of oldValues) {
        const el = list[item.mainIndex]
        if (!el) continue
        if (item.listFormat === undefined) {
          delete el.listFormat
        } else {
          el.listFormat = item.listFormat
        }
        if (item.listBulletChar === undefined) {
          delete el.listBulletChar
        } else {
          el.listBulletChar = item.listBulletChar
        }
        if (item.listNumberStyle === undefined) {
          delete el.listNumberStyle
        } else {
          el.listNumberStyle = item.listNumberStyle
        }
        if (item.listTemplateId === undefined) {
          delete el.listTemplateId
        } else {
          el.listTemplateId = item.listTemplateId
        }
      }
    }
    applyForwardStyle()
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        applyForwardStyle()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        applyBackwardStyle()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
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
    this.draw.invalidatePaintCache?.()
    this.draw.invalidateListLayoutCache?.()
    this.draw.render({ curIndex, isSetCursor })
    return true
  }

  /**
   * Word-style "Set Numbering Value". Two modes:
   *
   * 1. `continuePrevious = false` (default — "Start new list"): stamps
   *    `listStartValue = value` on every paragraph of the current list block.
   *    `computeListGlyphMap` seeds the bucket so the first item renders
   *    `value`, and subsequent items continue naturally (`value+1`, `value+2`…).
   *
   * 2. `continuePrevious = true` ("Continue from previous list"): finds the
   *    nearest preceding list element with a matching `listStyle`, copies its
   *    `listId` (and listStyle / listFormat / listNumberStyle) onto the
   *    current list block so both share one counter bucket. If `advance` is
   *    true, also stamps `listStartValue = value` to push the counter past
   *    the natural next number. If false, the counter just continues
   *    naturally from where the previous list left off.
   *
   * Pushes one snapshot history entry via the standard render path.
   *
   * @param value           1-based start (or skip-to value when advance=true)
   * @param continuePrevious  true → merge with prior list of same style
   * @param advance         only honored when continuePrevious=true; true means
   *                        the counter jumps to `value`, false means continue
   *                        from the natural next number
   */
  public setStartValue(
    value: number,
    continuePrevious: boolean = false,
    advance: boolean = false
  ): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    const changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId)
    if (!changeElementList || !changeElementList.length) return false
    const v = Math.max(1, Math.floor(value))
    let mutated = false

    if (continuePrevious) {
      const mainList = this.draw.getElementList()
      const firstChangeIdx = mainList.indexOf(changeElementList[0])
      if (firstChangeIdx < 0) return false
      const targetStyle = changeElementList[0].listStyle
      let prev: IElement | undefined
      for (let i = firstChangeIdx - 1; i >= 0; i--) {
        const candidate = mainList[i]
        if (!candidate.listId) continue
        if (candidate.listId === changeElementList[0].listId) continue
        if (candidate.listStyle !== targetStyle) continue
        prev = candidate
        break
      }
      if (!prev || !prev.listId) return false
      const targetListId = prev.listId
      const targetFormat = prev.listFormat
      const targetNumberStyle = prev.listNumberStyle
      changeElementList.forEach(el => {
        if (el.listId !== targetListId) {
          el.listId = targetListId
          mutated = true
        }
        if (targetFormat !== undefined && el.listFormat !== targetFormat) {
          el.listFormat = targetFormat
          mutated = true
        }
        if (
          targetNumberStyle !== undefined &&
          el.listNumberStyle !== targetNumberStyle
        ) {
          el.listNumberStyle = targetNumberStyle
          mutated = true
        }
        if (advance) {
          if (el.listStartValue !== v) {
            el.listStartValue = v
            mutated = true
          }
        } else if (el.listStartValue !== undefined) {
          delete el.listStartValue
          mutated = true
        }
      })
    } else {
      changeElementList.forEach(el => {
        if (el.listStartValue !== v) {
          el.listStartValue = v
          mutated = true
        }
      })
    }

    if (!mutated) return false
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.invalidatePaintCache?.()
    this.draw.invalidateListLayoutCache?.()
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
    // Align marker baseline to the same y the text uses. Position.ts derives
    // each element's offsetY as `curRow.ascent - rowMargin * 1.2`, so drawing
    // at `startY + row.ascent` puts the marker rowMargin*1.2 below the text
    // baseline. Use `position.ascent` (the ZERO element's per-element offsetY)
    // so number-period bottoms and checkbox bottoms sit on the text baseline.
    const y = startY + (position.ascent ?? ascent)
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

  public setChecklistStyle(checklistStyle: 'standard' | 'plain'): boolean {
    if (this.draw.isReadonly()) return false
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return false
    // Word-parity collapsed-cursor scope: restrict to same listLevel.
    const csCursorEl = this.draw.getElementList()[endIndex]
    const csCursorLevel = csCursorEl?.listLevel ?? 1
    const csIsCollapsedLevelScope =
      startIndex === endIndex && !!csCursorEl?.listId
    let changeElementList = this.range
      .getRangeParagraphElementList()
      ?.filter(el => el.listId && el.listStyle === ListStyle.CHECKBOX)
    if (!changeElementList || !changeElementList.length) return false
    if (csIsCollapsedLevelScope) {
      const filtered = changeElementList.filter(
        el => (el.listLevel ?? 1) === csCursorLevel
      )
      if (filtered.length) changeElementList = filtered
    }
    // Expand to entire list block.
    // First pass: walk same-listId neighbours (handles unified lists).
    // Second pass: walk any adjacent list paragraph (any listId) to catch
    // fragmented listIds from separate creation events.
    // Both passes respect listLevel under collapsed-cursor scope so child
    // checklist items don't drag parent checklist levels along.
    if (changeElementList[0]?.listId) {
      const mainList = this.draw.getElementList()
      let blockStart = mainList.indexOf(changeElementList[0])
      let blockEnd = mainList.indexOf(
        changeElementList[changeElementList.length - 1]
      )
      const blockListId = changeElementList[0].listId
      const passesLevel = (el: IElement | undefined) =>
        !csIsCollapsedLevelScope || (el?.listLevel ?? 1) === csCursorLevel
      // First pass: same listId
      while (
        blockStart > 0 &&
        mainList[blockStart - 1]?.listId === blockListId &&
        passesLevel(mainList[blockStart - 1])
      ) {
        blockStart--
      }
      while (
        blockEnd < mainList.length - 1 &&
        mainList[blockEnd + 1]?.listId === blockListId &&
        passesLevel(mainList[blockEnd + 1])
      ) {
        blockEnd++
      }
      // Second pass: any adjacent list paragraph (any listId)
      while (
        blockStart > 0 &&
        mainList[blockStart - 1]?.listId &&
        passesLevel(mainList[blockStart - 1])
      ) {
        blockStart--
      }
      while (
        blockEnd < mainList.length - 1 &&
        mainList[blockEnd + 1]?.listId &&
        passesLevel(mainList[blockEnd + 1])
      ) {
        blockEnd++
      }
      const expanded: IElement[] = []
      for (let i = blockStart; i <= blockEnd; i++) {
        if (mainList[i].listStyle !== ListStyle.CHECKBOX) continue
        if (!passesLevel(mainList[i])) continue
        expanded.push(mainList[i])
      }
      if (expanded.length > changeElementList.length) {
        changeElementList = expanded
      }
    }
    // Filter to all checklist elements in scope (marker + text), so
    // RangeManager reads the correct value regardless of cursor position.
    const checklistElements = changeElementList.filter(
      el => el.listId && el.listStyle === ListStyle.CHECKBOX
    )
    if (!checklistElements.length) return false
    // Capture old values for undo
    const mainList = this.draw.getElementList()
    const oldValues = checklistElements
      .map(el => ({
        mainIndex: mainList.indexOf(el),
        checklistStyle: el.checklistStyle
      }))
      .filter(v => v.mainIndex >= 0)
    const draw = this.draw
    // Issue 2: when switching checklist style, also refresh text styling
    // (strikethrough, muted color) on already-checked items so the visual
    // updates immediately instead of waiting for a re-toggle.
    const mutedColor = '#5F6368'
    const textRefresh: Array<{
      index: number
      oldStrikeout: boolean | undefined
      oldColor: string | undefined
    }> = []
    for (const el of checklistElements) {
      if (el.checkbox?.value && el.value === ZERO) {
        let t = mainList.indexOf(el) + 1
        while (t < mainList.length && mainList[t].value !== ZERO) {
          const tt = mainList[t].type
          if (!tt || TEXTLIKE_ELEMENT_TYPE.includes(tt)) {
            textRefresh.push({
              index: t,
              oldStrikeout: mainList[t].strikeout,
              oldColor: mainList[t].color
            })
          }
          t++
        }
      }
    }
    const applyForward = () => {
      const list = draw.getElementList()
      for (const item of oldValues) {
        const el = list[item.mainIndex]
        if (!el) continue
        el.checklistStyle = checklistStyle
      }
      // Issue 2: re-apply text styling for checked items
      for (const tr of textRefresh) {
        const te = list[tr.index]
        if (!te) continue
        te.color = mutedColor
        if (checklistStyle === 'standard') {
          te.strikeout = true
        } else {
          delete te.strikeout
        }
      }
    }
    const applyBackward = () => {
      const list = draw.getElementList()
      for (const item of oldValues) {
        const el = list[item.mainIndex]
        if (!el) continue
        if (item.checklistStyle === undefined) {
          delete el.checklistStyle
        } else {
          el.checklistStyle = item.checklistStyle
        }
      }
      // Issue 2: restore old text styling
      for (const tr of textRefresh) {
        const te = list[tr.index]
        if (!te) continue
        if (tr.oldStrikeout !== undefined) te.strikeout = tr.oldStrikeout
        else delete te.strikeout
        if (tr.oldColor !== undefined) te.color = tr.oldColor
        else delete te.color
      }
    }
    applyForward()
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        applyForward()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        applyBackward()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
    return true
  }
}
