import { Draw } from '../draw/Draw'

export class HistoryManager {
  private draw: Draw
  private undoStack: Array<Function> = []
  private redoStack: Array<Function> = []
  private maxRecordCount: number

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
