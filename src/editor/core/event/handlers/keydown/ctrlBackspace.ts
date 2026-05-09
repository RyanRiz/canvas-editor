import { ZERO, WRAP, HORIZON_TAB } from '../../../../dataset/constant/Common'
import {
  NUMBER_LIKE_REG,
  NUMBER_REG,
  WHITE_SPACE_REG
} from '../../../../dataset/constant/Regular'
import { ElementType } from '../../../../dataset/enum/Element'
import { CanvasEvent } from '../../CanvasEvent'

const BLOCK_TYPES = new Set([
  ElementType.TABLE,
  ElementType.IMAGE,
  ElementType.SEPARATOR,
  ElementType.PAGE_BREAK,
  ElementType.COLUMN_BREAK,
  ElementType.BLOCK,
  ElementType.LATEX
])

const LINE_BREAKS = new Set([ZERO, WRAP])

function isWs(char: string): boolean {
  return WHITE_SPACE_REG.test(char) || char === HORIZON_TAB
}

function isWord(char: string, letterReg: RegExp): boolean {
  return letterReg.test(char) || NUMBER_REG.test(char)
}

export function ctrlBackspace(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  if (draw.isReadonly()) return
  const rangeManager = draw.getRange()
  if (!rangeManager.getIsCanInput()) return
  const { startIndex, endIndex, isCrossRowCol } = rangeManager.getRange()

  // 表格跨行列选中：清空单元格内容
  if (isCrossRowCol) {
    const rowCol = draw.getTableParticle().getRangeRowCol()
    if (!rowCol) return
    let isDeleted = false
    for (let r = 0; r < rowCol.length; r++) {
      const row = rowCol[r]
      for (let c = 0; c < row.length; c++) {
        const col = row[c]
        if (col.value.length > 1) {
          draw.spliceElementList(col.value, 1, col.value.length - 1)
          isDeleted = true
        }
      }
    }
    const curIndex: number | null = isDeleted ? 0 : null
    if (curIndex === null) {
      rangeManager.setRange(startIndex, startIndex)
      draw.scheduleRender({
        curIndex: startIndex,
        isSubmitHistory: false
      })
    } else {
      rangeManager.setRange(curIndex, curIndex)
      draw.scheduleRender({ curIndex })
    }
    evt.preventDefault()
    return
  }

  // 有选区时直接删除选区
  if (!rangeManager.getIsCollapsed()) {
    const elementList = draw.getElementList()
    draw.spliceElementList(elementList, startIndex + 1, endIndex - startIndex)
    rangeManager.setRange(startIndex, startIndex)
    draw.scheduleRender({ curIndex: startIndex })
    evt.preventDefault()
    return
  }

  // 光标在控件内：回退到普通 backspace
  const control = draw.getControl()
  if (control.getActiveControl() && control.getIsRangeCanCaptureEvent()) {
    control.keydown(evt)
    control.emitControlContentChange()
    evt.preventDefault()
    return
  }

  const cursorPosition = draw.getPosition().getCursorPosition()
  if (!cursorPosition) return
  const { index } = cursorPosition
  // cursor 是伪代码中的"游标位置"——相当于 elementList 下标 index 之后的空隙
  const cursor = index + 1
  if (cursor <= 1) {
    evt.preventDefault()
    return
  }
  let pos = cursor

  const elementList = draw.getElementList()
  const LETTER_REG = draw.getLetterReg()

  // Step 1：跳过向后分隔符（空格 / 制表符等）
  while (pos > 0) {
    const el = elementList[pos - 1]
    if (!el) break
    if (el.type && BLOCK_TYPES.has(el.type)) break
    if (LINE_BREAKS.has(el.value)) break
    if (!isWs(el.value)) break
    pos--
  }

  // Step 2：识别并删除语义 token
  if (pos > 0) {
    const el = elementList[pos - 1]
    if (!el) {
      // 无元素，不操作
    } else if (el.type && BLOCK_TYPES.has(el.type)) {
      // 块级元素：原子删除
      pos--
    } else if (LINE_BREAKS.has(el.value)) {
      // 换行符：合并段落
      pos--
    } else if (isWord(el.value, LETTER_REG)) {
      // 单词 token：向后找到词首
      let hasDigit = NUMBER_REG.test(el.value)
      while (pos > 0) {
        const prev = elementList[pos - 1]
        if (!prev) break
        if (isWord(prev.value, LETTER_REG)) {
          pos--
          if (NUMBER_REG.test(prev.value)) hasDigit = true
        } else if (hasDigit && NUMBER_LIKE_REG.test(prev.value)) {
          // 小数点在数字上下文中视为词内字符（如 "3.14"）
          pos--
        } else {
          break
        }
      }
    } else {
      // 标点 / 符号 token：连续标点作为一个 token
      while (pos > 0) {
        const prev = elementList[pos - 1]
        if (!prev) break
        if (prev.type && BLOCK_TYPES.has(prev.type)) break
        if (LINE_BREAKS.has(prev.value)) break
        if (isWs(prev.value)) break
        if (isWord(prev.value, LETTER_REG)) break
        pos--
      }
    }
  }

  const deleteCount = cursor - pos
  if (deleteCount > 0) {
    draw.spliceElementList(elementList, pos, deleteCount)
    const curIndex = Math.max(0, pos - 1)
    rangeManager.setRange(curIndex, curIndex)
    draw.scheduleRender({ curIndex })
  }

  evt.preventDefault()
}
