import { HistoryEntry } from '../../interface/History'
import { Draw } from '../draw/Draw'

export type HistoryEntryListener = (entry: HistoryEntry) => void

/**
 * PERF-PLAN §1.2 / Phase 1.2：HistoryManager 内部 stack 支持的条目类型。
 *
 * 与已有的 `executeEntry(entry: HistoryEntry)` 公共结构化条目不同，本类型
 * 仅作为 stack 的「物理表示」：legacy `execute(fn)` 推入 Function（=
 * snapshot 还原器，对任意当前状态都能直接还原到目的状态）；新版
 * `executeDelta(delta)` 推入 delta，必须根据 undo / redo 方向调用对应的
 * apply 函数。
 *
 * 在 stack 内并存合法且必要：
 *   - 第一项（初始状态）始终是 snapshot；
 *   - 中间允许任意混合——遇到 snapshot 时 undo 之后调用其前一项的 forward，
 *     遇到 delta 时直接 applyBackward。
 */
type StackItem =
  | Function
  | {
      kind: 'delta'
      applyForward: () => void
      applyBackward: () => void
    }

export class HistoryManager {
  private draw: Draw
  private undoStack: Array<StackItem> = []
  private redoStack: Array<StackItem> = []
  private maxRecordCount: number
  // PERF-PLAN §3.4：结构化条目订阅者。executeEntry 推入时通知。
  private entryListeners: Set<HistoryEntryListener> = new Set()

  constructor(draw: Draw) {
    this.draw = draw
    // 忽略第一次历史记录
    this.maxRecordCount = draw.getOptions().historyMaxRecordCount + 1
  }

  private _debugLog(action: string, extra?: Record<string, unknown>) {
    if (!this.draw.getOptions().debugHistory) return
    console.log('[canvas-editor history]', {
      action,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      undoTop: this._describeStackItem(this.undoStack[this.undoStack.length - 1]),
      redoTop: this._describeStackItem(this.redoStack[this.redoStack.length - 1]),
      ...extra
    })
  }

  private _describeStackItem(item: StackItem | undefined) {
    if (!item) return null
    return typeof item === 'function' ? 'snapshot' : item.kind
  }

  public undo() {
    // 输入合批未落盘时，先落盘再 undo（PERF-PLAN §1.2）
    this.draw.flushTypingBatch()
    if (this.undoStack.length > 0) {
      const pop = this.undoStack.pop()!
      this.redoStack.push(pop)
      this._debugLog('undo:popped', {
        popped: this._describeStackItem(pop),
        newUndoTop: this._describeStackItem(
          this.undoStack[this.undoStack.length - 1]
        )
      })
      if (typeof pop === 'function') {
        // legacy snapshot：把状态拨回新的栈顶。若新的栈顶是 delta，则需要
        // 从其最近的前置 snapshot 重建，再顺序重放中间所有 delta。
        this._restoreUndoStackTop()
      } else {
        // delta：自带 BEFORE 元数据，直接反向应用
        pop.applyBackward()
      }
    }
    this._debugLog('undo:end')
  }

  public redo() {
    this.draw.flushTypingBatch()
    if (this.redoStack.length) {
      const pop = this.redoStack.pop()!
      this.undoStack.push(pop)
      this._debugLog('redo:shifted', {
        shifted: this._describeStackItem(pop)
      })
      if (typeof pop === 'function') {
        pop()
      } else {
        pop.applyForward()
      }
    }
    this._debugLog('redo:end')
  }

  public execute(fn: Function) {
    this.undoStack.push(fn)
    if (this.redoStack.length) {
      this.redoStack = []
    }
    while (this.undoStack.length > this.maxRecordCount) {
      this.undoStack.shift()
    }
    this._debugLog('push:snapshot')
  }

  /**
   * PERF-PLAN §1.2 / Phase 1.2：以 delta 形式推入 history 条目。
   *
   * 与 {@link execute} 的最大差别：执行 undo / redo 时调用 applyBackward /
   * applyForward 应用 mutation 序列，而不是 deepClone 整篇文档再覆盖。
   * 适用场景：连续 typing batch flush、Enter / Backspace / 纯 splice 命令。
   */
  public executeDelta(delta: {
    applyForward: () => void
    applyBackward: () => void
  }) {
    if (this.draw.isHistoryDisabled()) return
    this.undoStack.push({
      kind: 'delta',
      applyForward: delta.applyForward,
      applyBackward: delta.applyBackward
    })
    if (this.redoStack.length) {
      this.redoStack = []
    }
    while (this.undoStack.length > this.maxRecordCount) {
      this.undoStack.shift()
    }
    this._debugLog('push:delta')
  }

  /**
   * 推入结构化条目（PERF-PLAN §3.4）。
   *
   * 内部仍复用 `execute(fn)`：把 entry.undo 作为 stack 函数。但订阅者会通过
   * {@link onEntry} 收到完整的结构化条目，可用于实现 CRDT op log、远端同步、
   * 崩溃恢复持久化等。原有 `execute(fn)` 调用路径不受影响。
   */
  public executeEntry(entry: HistoryEntry) {
    this.execute(entry.undo)
    if (this.entryListeners.size > 0) {
      // 拷贝集合再迭代，避免订阅者在回调中改 listener 集合时出现死锁
      for (const listener of Array.from(this.entryListeners)) {
        try {
          listener(entry)
        } catch {
          /* 订阅者异常不应影响历史栈 */
        }
      }
    }
  }

  /**
   * 订阅结构化历史条目。返回反订阅函数。
   *
   * 典型用例：CRDT runtime 把 entry 流作为本地 op 序列广播；审计日志把 entry
   * 序列化到外部存储。订阅是「附加」语义——回调异常被吞掉，不会影响 undo / redo。
   */
  public onEntry(listener: HistoryEntryListener): () => void {
    this.entryListeners.add(listener)
    return () => {
      this.entryListeners.delete(listener)
    }
  }

  public isCanUndo(): boolean {
    // 合批中虽然栈尚未增加新条目，但用户语义上「有内容可撤销」
    return this.undoStack.length > 1 || this.draw.isTypingBatchActive()
  }

  public isCanRedo(): boolean {
    return !!this.redoStack.length
  }

  public isStackEmpty(): boolean {
    return !this.undoStack.length && !this.redoStack.length
  }

  public recovery() {
    this.undoStack = []
    this.redoStack = []
  }

  public popUndo() {
    return this.undoStack.pop()
  }

  private _restoreUndoStackTop() {
    const topIndex = this.undoStack.length - 1
    if (topIndex < 0) return
    const top = this.undoStack[topIndex]
    if (typeof top === 'function') {
      this._debugLog('undo:restore-top-snapshot')
      top()
      return
    }

    let snapshotIndex = topIndex - 1
    while (
      snapshotIndex >= 0 &&
      typeof this.undoStack[snapshotIndex] !== 'function'
    ) {
      snapshotIndex--
    }
    if (snapshotIndex < 0) return

    const snapshot = this.undoStack[snapshotIndex]
    if (typeof snapshot !== 'function') return
    this._debugLog('undo:restore-from-snapshot', {
      snapshotIndex,
      topIndex
    })
    snapshot()

    for (let i = snapshotIndex + 1; i <= topIndex; i++) {
      const item = this.undoStack[i]
      if (typeof item === 'function') {
        item()
      } else {
        item.applyForward()
      }
    }
  }
}
