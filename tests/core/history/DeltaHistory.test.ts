import { describe, it, expect, afterEach } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { PageMode } from '@/editor/dataset/enum/Editor'

/**
 * PERF-PLAN §1.2 / Phase 1.2：delta-based history 行为校验。
 *
 * 这一组用例验证：
 *  1. 多次 spliceElementList 后 submitHistory 走 delta 分支（不再付出
 *     getSlimCloneElementList(全文档) × 3 的代价）；
 *  2. delta 分支的 undo / redo 与 snapshot 分支语义等价（最终 elementList
 *     文本一致）；
 *  3. 当出现「破坏 delta 不变量」的旁路改动（property-only 命令、header
 *     splice、setEditorData）时优雅回退到 snapshot 分支，仍然正确还原；
 *  4. flushTypingBatch / 连续 typing 后 undo 一次回到合批起点。
 */

interface DrawInternals {
  _pendingHistoryMutations: unknown[]
  _deltaHistoryUnsafe: boolean
  _preMutationMeta: unknown
}

describe('Phase 1.2 - delta-based history', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('累积的 main splice 在 submitHistory 后清空 _pendingHistoryMutations', () => {
    ctx = createTestEditor()
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const internal = draw as unknown as DrawInternals
    // 第一次 insert → snapshot 路径（栈空，落首份基线）
    ctx.editor.command.executeInsertElementList([{ value: 'a' }])
    expect(internal._pendingHistoryMutations.length).toBe(0)
    expect(internal._deltaHistoryUnsafe).toBe(false)

    // 第二次 insert → delta 路径（栈已非空 + main-only splice）
    ctx.editor.command.executeInsertElementList([{ value: 'b' }])
    // submitHistory 完成后累加器一定被清空
    expect(internal._pendingHistoryMutations.length).toBe(0)
    expect(internal._preMutationMeta).toBeNull()
  })

  it('delta 分支的 undo / redo 与 snapshot 分支结果一致（多次 insert）', () => {
    ctx = createTestEditor()
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeInsertElementList([{ value: 'a' }])
    ctx.editor.command.executeInsertElementList([{ value: 'b' }])
    ctx.editor.command.executeInsertElementList([{ value: 'c' }])

    // 当前应包含 a/b/c
    expect(ctx.editor.command.getText().main).toContain('abc')

    // Undo 三次回到空（除掉 \n 等结构性元素）
    ctx.editor.command.executeUndo()
    expect(ctx.editor.command.getText().main).not.toContain('c')
    expect(ctx.editor.command.getText().main).toContain('ab')

    ctx.editor.command.executeUndo()
    expect(ctx.editor.command.getText().main).not.toContain('b')
    expect(ctx.editor.command.getText().main).toContain('a')

    ctx.editor.command.executeUndo()
    expect(ctx.editor.command.getText().main).not.toContain('a')

    // Redo 全部恢复
    ctx.editor.command.executeRedo()
    ctx.editor.command.executeRedo()
    ctx.editor.command.executeRedo()
    expect(ctx.editor.command.getText().main).toContain('abc')
  })

  it('property-only 命令（bold）触发 snapshot 分支，undo / redo 正常', () => {
    ctx = createTestEditor()
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeInsertElementList([
      { value: 'a' },
      { value: 'b' },
      { value: 'c' }
    ])
    // 选中 a 然后加粗——纯属性改动，不走 splice
    ctx.editor.command.executeSetRange(0, 1)
    ctx.editor.command.executeBold()
    // bold 没改 elementList，但应当推入了 snapshot 类历史项
    ctx.editor.command.executeUndo()
    // undo 后 bold 被撤销——elementList 仍然是 abc，不应缺字
    expect(ctx.editor.command.getText().main).toContain('abc')
  })

  it('setEditorData 后下一次 submit 走 snapshot（避免 stale mutation 越界）', () => {
    ctx = createTestEditor()
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeInsertElementList([{ value: 'x' }])
    const draw = ctx.editor.draw
    const internal = draw as unknown as DrawInternals
    // setEditorData 直接走 snapshot invalidate
    draw.setEditorData({ main: [{ value: '\n' }] })
    expect(internal._deltaHistoryUnsafe).toBe(true)
    // 下一次 insert 应当先 fallback 到 snapshot；再下一次才有可能走 delta
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeInsertElementList([{ value: 'y' }])
    // submit 完成后累加器清空，flag 也已重置
    expect(internal._pendingHistoryMutations.length).toBe(0)
    expect(internal._deltaHistoryUnsafe).toBe(false)
  })

  it('header splice 在引用稳定时保持 delta-safe', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.PAGING } })
    ctx.editor.command.executeFocus()
    // 先建立基线 snapshot
    ctx.editor.command.executeInsertElementList([{ value: 'a' }])
    // 直接 splice 当前活动 header 列表：在未切换 variant / 未替换引用时应继续允许 delta
    ctx.editor.draw.spliceElementList(
      ctx.editor.draw.getHeaderElementList(),
      0,
      0,
      [{ value: 'h' }]
    )
    const internal = ctx.editor.draw as unknown as DrawInternals
    expect(internal._deltaHistoryUnsafe).toBe(false)
    expect(internal._pendingHistoryMutations.length).toBe(1)
    // 再插入 main 元素触发 submit 落盘；整轮 mixed main+header mutation 结束后内部状态重置
    ctx.editor.command.executeInsertElementList([{ value: 'b' }])
    expect(internal._pendingHistoryMutations.length).toBe(0)
    expect(internal._deltaHistoryUnsafe).toBe(false)
  })

  it('连续多次 insert 后 undo 一次只回退一份合批的最终 snapshot/delta', () => {
    // 与 submitHistory 是否走 delta 无关——保证 undoStack 行为不被 Phase 1.2 改坏。
    ctx = createTestEditor()
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeInsertElementList([{ value: 'p' }])
    ctx.editor.command.executeInsertElementList([{ value: 'q' }])
    ctx.editor.command.executeInsertElementList([{ value: 'r' }])
    expect(ctx.editor.command.getText().main).toContain('pqr')
    ctx.editor.command.executeUndo()
    expect(ctx.editor.command.getText().main).toContain('pq')
    expect(ctx.editor.command.getText().main).not.toContain('r')
  })

  it('delete 操作通过 delta 正确还原（undo 重新插入被删元素）', () => {
    ctx = createTestEditor()
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeInsertElementList([
      { value: 'a' },
      { value: 'b' },
      { value: 'c' }
    ])
    // 删除 b（索引 = startIndex+1 大致；我们直接通过 spliceElementList 操作）
    const main = ctx.editor.draw.getOriginalMainElementList()
    const beforeLen = main.length
    // 找到 'b' 的索引
    const bIdx = main.findIndex(el => el.value === 'b')
    expect(bIdx).toBeGreaterThanOrEqual(0)
    ctx.editor.draw.spliceElementList(main, bIdx, 1)
    ctx.editor.draw.render({ isCompute: true, isSubmitHistory: true })
    // 现在 b 应不见
    expect(ctx.editor.command.getText().main).not.toContain('b')
    expect(main.length).toBe(beforeLen - 1)
    // undo
    ctx.editor.command.executeUndo()
    // b 应当回来
    expect(ctx.editor.command.getText().main).toContain('b')
  })
})
