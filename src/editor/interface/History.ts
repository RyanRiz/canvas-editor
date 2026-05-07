import { IElement } from './Element'

/**
 * 历史栈条目的类型化表示（PERF-PLAN §3.4）。
 *
 * 历史 HistoryManager 内部存放的是 `Function`：一对 undo / redo 的闭包。
 * Phase 3 引入此 tagged union 作为「显式」strategy，与函数栈并行存在：
 *
 *   - 现有调用方可继续通过 `historyManager.execute(fn)` 推入闭包，行为不变；
 *   - 新调用方可通过 `historyManager.executeEntry(entry)` 推入结构化条目，
 *     条目记录了 op kind 与 payload，便于后续：
 *       - CRDT 集成将 entry 流作为本地 op log
 *       - 持久化 / 崩溃恢复（序列化 entries 远比序列化闭包可靠）
 *       - 合并连续的 insert（典型场景：typing 合批）
 *
 * 现阶段不替换函数栈——`executeEntry` 内部仍走 `execute(fn)` 路径，并把
 * 结构化数据通过事件 `historyEntry` 暴露给订阅者。Phase 4+ 才考虑把内部
 * stack 改写为 `HistoryEntry[]`。
 */
export type HistoryEntry =
  | IHistorySnapshotEntry
  | IHistoryInsertEntry
  | IHistoryDeleteEntry
  | IHistoryReplaceEntry

export interface IHistoryEntryBase {
  /** 操作发生的 elementList 作用域；CRDT 同步时据此选择对应 doc/sub-doc。 */
  scope: HistoryScope
  /** 单调时间戳（performance.now()），调试与去重用。 */
  timestamp: number
  /** 闭包：执行后回到 undo 状态。HistoryManager 推入栈时仍存这个。 */
  undo: () => void
  /** 闭包：执行后回到 redo 状态。 */
  redo: () => void
}

export type HistoryScope = 'main' | 'header' | 'footer' | 'table'

/** 全量快照——与现有 submitHistory 等价，作为兜底类型。 */
export interface IHistorySnapshotEntry extends IHistoryEntryBase {
  kind: 'snapshot'
}

/** 在 `at` 位置插入了 `items`。 */
export interface IHistoryInsertEntry extends IHistoryEntryBase {
  kind: 'insert'
  at: number
  items: IElement[]
}

/** 在 `[at, at + removed.length)` 删除了 `removed`。 */
export interface IHistoryDeleteEntry extends IHistoryEntryBase {
  kind: 'delete'
  at: number
  removed: IElement[]
}

/** `[at, at + removed.length)` 被 `inserted` 替换。 */
export interface IHistoryReplaceEntry extends IHistoryEntryBase {
  kind: 'replace'
  at: number
  removed: IElement[]
  inserted: IElement[]
}
