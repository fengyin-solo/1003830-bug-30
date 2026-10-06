/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 行上记录归属单位的字段名；设置后跨单位人员只能查看，不能执行动作 */
  ownerField?: string
  /** 归档动作名：归档是标记操作（写 archived），不改状态 */
  archiveAction?: string
  /** 为 true 时状态只能按 statuses 顺序逐步向前推进，不允许倒退或跳步 */
  oneWay?: boolean
  /** 视为办结的状态（不再计入待办）；缺省取 statuses 最后一个 */
  doneStatuses?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
