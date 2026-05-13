import { ZERO } from '../../../../dataset/constant/Common'
import { MoveDirection } from '../../../../dataset/enum/Observer'
import { IElement } from '../../../../interface/Element'
import { CanvasEvent } from '../../CanvasEvent'

export function tab(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  const isReadonly = draw.isReadonly()
  if (isReadonly) return
  evt.preventDefault()

  const control = draw.getControl()
  const activeControl = control.getActiveControl()
  if (activeControl && control.getIsRangeWithinControl()) {
    control.initNextControl({
      direction: evt.shiftKey ? MoveDirection.UP : MoveDirection.DOWN
    })
    return
  }

  const rangeManager = draw.getRange()
  const elementList = draw.getElementList()
  const { startIndex, endIndex } = rangeManager.getRange()
  const isCollapsed = rangeManager.getIsCollapsed()
  const listParticle = draw.getListParticle()

  if (!isCollapsed) {
    const paragraphs = rangeManager.getRangeParagraphElementList()
    const hasList = paragraphs?.some(el => el.listId)
    if (hasList) {
      if (evt.shiftKey) {
        listParticle.outdent()
      } else {
        listParticle.indent()
      }
      return
    }
  } else {
    const endElement = elementList[endIndex]
    const atListItemStart = !!endElement?.listId && endElement.value === ZERO
    if (atListItemStart) {
      if (evt.shiftKey) {
        listParticle.outdent()
      } else {
        listParticle.indent()
      }
      return
    }
  }

  // 缩进/减少缩进（Tab = 首行缩进：仅当前视觉行）
  if (!~startIndex && !~endIndex) return
  // 收集本次受影响的「行内元素」及其在主元素列表中的索引——
  //   1) executeDelta 需要稳定的 (el, oldIndent) 二元组以重放 / 反向应用；
  //   2) markDirty 需要 [rowStart..rowEnd] 才能让 _tryBuildResumeFrom 把
  //      整行装进 dirty 区间，否则 dirty 仅覆盖光标点，convergence 早于
  //      行末退出，行宽变化得不到重排。
  //   3) 走 executeDelta 而不是默认 snapshot：snapshot deepClone elementList，
  //      undo 时 this.elementList 被整片替换，旧的 row.elementList 全部失效，
  //      下一帧 _tryConvergeIncrementalRowList 找不到任何 ref 相等的旧行，
  //      退化为 walk-to-end-of-doc（实测 ~2.5s on 34 页）。
  const rangeRow = rangeManager.getRangeRow()
  if (!rangeRow) return
  const positionList = draw.getPosition().getPositionList()
  // Tab mutates only the first element of each visual row. Draw.ts locks
  // curRow.offsetX off the row's first element (see Draw.ts §"first-line-Tab +
  // wrapped elements"), so indenting trailing elements is redundant for the
  // current layout — but it becomes harmful after a wrap: bumping indent
  // narrows the row, a tail element pushes to the next row carrying its
  // freshly-set indent, and the next row's offsetX gets locked from it too →
  // two visual rows indented for one Tab. Restricting the mutation to the
  // row-leading element keeps "first-line indent" semantics stable under
  // reflow. dirtyStart/dirtyEnd still span every row position so the
  // incremental layout reflows the full affected row, not just its head.
  const affected: Array<{ el: IElement; oldIndent: number | undefined }> = []
  const seenRows = new Set<string>()
  let dirtyStart = Number.POSITIVE_INFINITY
  let dirtyEnd = Number.NEGATIVE_INFINITY
  for (let p = 0; p < positionList.length; p++) {
    const position = positionList[p]
    const rowSet = rangeRow.get(position.pageNo)
    if (!rowSet) continue
    if (rowSet.has(position.rowNo)) {
      const el = elementList[p]
      if (!el) continue
      const rowKey = `${position.pageNo}:${position.rowNo}`
      if (!seenRows.has(rowKey)) {
        seenRows.add(rowKey)
        affected.push({ el, oldIndent: el.indent })
      }
      if (p < dirtyStart) dirtyStart = p
      if (p > dirtyEnd) dirtyEnd = p
    }
  }
  if (!affected.length) return
  const isShift = evt.shiftKey
  // 当前路径下没有任何元素的 indent 会变化（全 0 时按 shift+Tab）→ 不入栈也不重渲染
  if (isShift && affected.every(({ el }) => (el.indent || 0) === 0)) {
    return
  }
  // 就地应用 forward，使本次操作立刻生效；同样的闭包用作 redo。
  const applyMutation = () => {
    for (const { el } of affected) {
      const cur = el.indent || 0
      if (isShift) {
        if (cur > 0) el.indent = cur - 1
      } else {
        el.indent = cur + 1
      }
    }
  }
  const revertMutation = () => {
    for (const { el, oldIndent } of affected) {
      if (oldIndent !== undefined) el.indent = oldIndent
      else delete el.indent
    }
  }
  applyMutation()
  const isSetCursor = startIndex === endIndex
  const curIndex = isSetCursor ? endIndex : startIndex
  draw.getHistoryManager().executeDelta({
    applyForward: () => {
      applyMutation()
      draw.markDirty(dirtyStart, dirtyEnd)
      draw.cancelScheduledRender()
      draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
    },
    applyBackward: () => {
      revertMutation()
      draw.markDirty(dirtyStart, dirtyEnd)
      draw.cancelScheduledRender()
      draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
    }
  })
  draw.markDirty(dirtyStart, dirtyEnd)
  draw.cancelScheduledRender()
  draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
}
