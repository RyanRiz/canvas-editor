import { describe, it, expect, afterEach, vi } from 'vitest'
import { createTestEditor } from '../../factories/editor'

/**
 * P1.2 输入合批：连续 keystroke 合并为单个 history snapshot。
 * 仅在 historyTypingBatchMs > 0 时启用；默认 0 时保持每键一份 snapshot 的旧语义。
 *
 * 这些用例直接调用 canvasEvent.input(...) 模拟 IME / 真实键盘事件落到
 * input handler 的 fast path，再用 draw.flushScheduledRender() 显式驱动
 * rAF 队列，避免依赖宿主的真实帧节拍。
 */
describe('HistoryManager - typing batch (P1.2)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => {
    ctx?.destroy()
    vi.useRealTimers()
  })

  it('historyTypingBatchMs=0（默认）时不合批：rAF 合并后每帧仍会触发 submitHistory', () => {
    ctx = createTestEditor({ options: { historyTypingBatchMs: 0 } })
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const submitSpy = vi.spyOn(draw, 'submitHistory')
    const canvasEvent = draw.getCanvasEvent()
    canvasEvent.input('a')
    draw.flushScheduledRender()
    canvasEvent.input('b')
    draw.flushScheduledRender()
    canvasEvent.input('c')
    draw.flushScheduledRender()
    expect(submitSpy).toHaveBeenCalledTimes(3)
    expect(draw.isTypingBatchActive()).toBe(false)
  })

  it('historyTypingBatchMs>0 时合批：N 帧 keystroke 期间不 submit，flush 时一次落盘', () => {
    vi.useFakeTimers()
    ctx = createTestEditor({ options: { historyTypingBatchMs: 500 } })
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const canvasEvent = draw.getCanvasEvent()
    // 第一次输入：栈非空（focus 已 push 初始 snapshot），合批生效
    canvasEvent.input('a')
    draw.flushScheduledRender()
    const submitSpy = vi.spyOn(draw, 'submitHistory')
    canvasEvent.input('b')
    draw.flushScheduledRender()
    canvasEvent.input('c')
    draw.flushScheduledRender()
    canvasEvent.input('d')
    draw.flushScheduledRender()
    // 合批中：尚未 flush
    expect(submitSpy).toHaveBeenCalledTimes(0)
    expect(draw.isTypingBatchActive()).toBe(true)
    // 闲置触发
    vi.advanceTimersByTime(500)
    expect(submitSpy).toHaveBeenCalledTimes(1)
    expect(draw.isTypingBatchActive()).toBe(false)
  })

  it('undo 在合批中时先 flush 再撤销', () => {
    ctx = createTestEditor({ options: { historyTypingBatchMs: 500 } })
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const canvasEvent = draw.getCanvasEvent()
    canvasEvent.input('a')
    draw.flushScheduledRender()
    canvasEvent.input('b')
    draw.flushScheduledRender()
    canvasEvent.input('c')
    draw.flushScheduledRender()
    expect(draw.isTypingBatchActive()).toBe(true)
    ctx.editor.command.executeUndo()
    // flushTypingBatch 在 undo 内被调用，合批应被清空
    expect(draw.isTypingBatchActive()).toBe(false)
  })

  it('isCanUndo 在合批进行中视为 true', () => {
    ctx = createTestEditor({ options: { historyTypingBatchMs: 500 } })
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const historyManager = (
      draw as unknown as { historyManager: { isCanUndo(): boolean } }
    ).historyManager
    draw.getCanvasEvent().input('x')
    draw.flushScheduledRender()
    expect(draw.isTypingBatchActive()).toBe(true)
    expect(historyManager.isCanUndo()).toBe(true)
  })

  it('destroy 时清理合批定时器，不抛错', () => {
    vi.useFakeTimers()
    ctx = createTestEditor({ options: { historyTypingBatchMs: 500 } })
    ctx.editor.command.executeFocus()
    ctx.editor.draw.getCanvasEvent().input('a')
    ctx.editor.draw.flushScheduledRender()
    expect(() => ctx.destroy()).not.toThrow()
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
  })

  it('rAF 合并：同一同步刻内连续 keystroke 仅产生一帧 layout', () => {
    ctx = createTestEditor({ options: { historyTypingBatchMs: 0 } })
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const renderSpy = vi.spyOn(draw, 'render')
    const canvasEvent = draw.getCanvasEvent()
    canvasEvent.input('a')
    canvasEvent.input('b')
    canvasEvent.input('c')
    // 三次 input 仅排了一帧；尚未 flush 时 render 应未被调用
    expect(renderSpy).toHaveBeenCalledTimes(0)
    draw.flushScheduledRender()
    expect(renderSpy).toHaveBeenCalledTimes(1)
  })
})
