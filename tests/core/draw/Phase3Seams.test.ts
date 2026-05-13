import { describe, it, expect, afterEach, vi } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { IMutationEvent } from '@/editor/interface/Mutation'
import { HistoryEntry } from '@/editor/interface/History'
import { IElement } from '@/editor/interface/Element'

/**
 * PERF-PLAN Phase 3 接缝层（onMutation / executeEntry / 自动 id）。
 *
 * Phase 3 不改变现有运行时语义，仅引入「未来 CRDT / 审计 / 持久化」需要的
 * 集成点。这些用例直接验证接缝可被订阅、payload 字段稳定、且不与既有逻辑冲突。
 */
describe('Draw - Phase 3 mutation event seam', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('onMutation 在 spliceElementList 后收到 splice 事件', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const events: IMutationEvent[] = []
    const unsubscribe = draw.onMutation(e => events.push(e))
    draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, [
      { value: 'a' },
      { value: 'b' }
    ])
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('splice')
    expect(events[0].scope).toBe('main')
    expect(events[0].start).toBe(0)
    expect(events[0].inserted).toHaveLength(2)
    expect(events[0].removed).toHaveLength(0)
    unsubscribe()
  })

  it('onMutation 区分 main / header / footer scope', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const seen: string[] = []
    draw.onMutation(e => seen.push(e.scope))
    draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, [
      { value: 'm' }
    ])
    draw.spliceElementList(draw.getHeaderElementList(), 0, 0, [{ value: 'h' }])
    draw.spliceElementList(draw.getFooterElementList(), 0, 0, [{ value: 'f' }])
    expect(seen).toEqual(['main', 'header', 'footer'])
  })

  it('onMutation 反订阅函数生效', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const handler = vi.fn()
    const unsubscribe = draw.onMutation(handler)
    draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, [
      { value: 'x' }
    ])
    expect(handler).toHaveBeenCalledTimes(1)
    unsubscribe()
    draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, [
      { value: 'y' }
    ])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('onMutation 订阅者抛错不会污染突变路径', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    draw.onMutation(() => {
      throw new Error('subscriber boom')
    })
    expect(() =>
      draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, [
        { value: 'z' }
      ])
    ).not.toThrow()
  })

  it('删除事件 removed 切片在 splice 完成后仍然可用', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const main = draw.getOriginalMainElementList()
    // 先放点东西进去
    draw.spliceElementList(main, 0, 0, [{ value: 'a' }, { value: 'b' }])
    const events: IMutationEvent[] = []
    draw.onMutation(e => events.push(e))
    draw.spliceElementList(main, 0, 1)
    const last = events[events.length - 1]
    expect(last.kind).toBe('splice')
    // 切片应该是「已被删除的元素」，且对调用方可见
    expect(last.removed.length).toBeGreaterThan(0)
  })
})

describe('Draw - Phase 3 auto-id at Mutator boundary (§6.2a)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('插入元素时缺失的 id 会被自动填充', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const items: IElement[] = [{ value: 'a' }, { value: 'b' }]
    draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, items)
    expect(items[0].id).toBeTruthy()
    expect(items[1].id).toBeTruthy()
    expect(items[0].id).not.toBe(items[1].id)
  })

  it('已有 id 的元素不会被覆盖', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const item: IElement = { value: 'a', id: 'preset-id' }
    draw.spliceElementList(draw.getOriginalMainElementList(), 0, 0, [item])
    expect(item.id).toBe('preset-id')
  })

  it('header / footer 路径的元素同样自动 id', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const header: IElement[] = [{ value: 'h' }]
    const footer: IElement[] = [{ value: 'f' }]
    draw.spliceElementList(draw.getHeaderElementList(), 0, 0, header)
    draw.spliceElementList(draw.getFooterElementList(), 0, 0, footer)
    expect(header[0].id).toBeTruthy()
    expect(footer[0].id).toBeTruthy()
  })
})

describe('HistoryManager - Phase 3 typed entries (§3.4)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('executeEntry 推入条目并通知 onEntry 订阅者', () => {
    ctx = createTestEditor()
    const historyManager = (
      ctx.editor.draw as unknown as {
        historyManager: {
          executeEntry: (e: HistoryEntry) => void
          onEntry: (l: (e: HistoryEntry) => void) => () => void
        }
      }
    ).historyManager
    const events: HistoryEntry[] = []
    const unsubscribe = historyManager.onEntry(e => events.push(e))
    const undoFn = vi.fn()
    const redoFn = vi.fn()
    historyManager.executeEntry({
      kind: 'insert',
      scope: 'main',
      timestamp: 0,
      at: 0,
      items: [{ value: 'a' }],
      undo: undoFn,
      redo: redoFn
    })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('insert')
    expect(events[0].scope).toBe('main')
    unsubscribe()
  })

  it('executeEntry 入栈后 isCanUndo 立即为 true（与 execute 等价）', () => {
    ctx = createTestEditor()
    const historyManager = (
      ctx.editor.draw as unknown as {
        historyManager: {
          executeEntry: (e: HistoryEntry) => void
          isCanUndo: () => boolean
        }
      }
    ).historyManager
    const before = historyManager.isCanUndo()
    historyManager.executeEntry({
      kind: 'snapshot',
      scope: 'main',
      timestamp: 0,
      undo: () => {},
      redo: () => {}
    })
    historyManager.executeEntry({
      kind: 'snapshot',
      scope: 'main',
      timestamp: 0,
      undo: () => {},
      redo: () => {}
    })
    expect(historyManager.isCanUndo()).toBe(true)
    expect(before).toBe(false)
  })

  it('onEntry 订阅者抛错不影响 stack 推入', () => {
    ctx = createTestEditor()
    const historyManager = (
      ctx.editor.draw as unknown as {
        historyManager: {
          executeEntry: (e: HistoryEntry) => void
          onEntry: (l: (e: HistoryEntry) => void) => () => void
          isCanUndo: () => boolean
        }
      }
    ).historyManager
    historyManager.onEntry(() => {
      throw new Error('listener boom')
    })
    expect(() =>
      historyManager.executeEntry({
        kind: 'snapshot',
        scope: 'main',
        timestamp: 0,
        undo: () => {},
        redo: () => {}
      })
    ).not.toThrow()
  })
})
