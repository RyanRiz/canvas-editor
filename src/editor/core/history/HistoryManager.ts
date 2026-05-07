import { HistoryEntry } from '../../interface/History'
import { Draw } from '../draw/Draw'

export type HistoryEntryListener = (entry: HistoryEntry) => void

export class HistoryManager {
  private draw: Draw
  private undoStack: Array<Function> = []
  private redoStack: Array<Function> = []
  private maxRecordCount: number
  // PERF-PLAN §3.4：结构化条目订阅者。executeEntry 推入时通知。
  private entryListeners: Set<HistoryEntryListener> = new Set()

  constructor(draw: Draw) {
    this.draw = draw
    // 忽略第一次历史记录
    this.maxRecordCount = draw.getOptions().historyMaxRecordCount + 1
  }

  public undo() {
    // 输入合批未落盘时，先落盘再 undo（PERF-PLAN §1.2）
    this.draw.flushTypingBatch()
    if (this.undoStack.length > 1) {
      const pop = this.undoStack.pop()!
      this.redoStack.push(pop)
      if (this.undoStack.length) {
        this.undoStack[this.undoStack.length - 1]()
      }
    }
  }

  public redo() {
    this.draw.flushTypingBatch()
    if (this.redoStack.length) {
      const pop = this.redoStack.pop()!
      this.undoStack.push(pop)
      pop()
    }
  }

  public execute(fn: Function) {
    this.undoStack.push(fn)
    if (this.redoStack.length) {
      this.redoStack = []
    }
    while (this.undoStack.length > this.maxRecordCount) {
      this.undoStack.shift()
    }
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
}
