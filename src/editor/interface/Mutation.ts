import { IElement } from './Element'
import { HistoryScope } from './History'

/**
 * 元素列表突变事件（PERF-PLAN §3.1 light seam）。
 *
 * `Draw` 里所有结构性变更最终都走 `spliceElementList`——这是 Mutator 的
 * de-facto 边界。本类型作为该边界的事件载体：调用方通过 `draw.onMutation()`
 * 订阅，即可在不修改核心代码的前提下接入 CRDT runtime、审计日志、远端
 * 同步等横切关注点。
 *
 * 事件描述「已发生」而非「即将发生」——回调收到时 elementList 已经被改写。
 */
export interface IMutationEvent {
  kind: 'splice'
  /** 改动落在哪个 elementList 作用域。 */
  scope: HistoryScope
  /** 起始索引（与 `Array.prototype.splice` 一致）。 */
  start: number
  /** 被删除的元素切片（splice 调用前后）。空数组表示纯插入。 */
  removed: IElement[]
  /** 被插入的元素切片。空数组表示纯删除。 */
  inserted: IElement[]
}

export type MutationListener = (event: IMutationEvent) => void
