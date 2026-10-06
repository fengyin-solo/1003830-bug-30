import type { EntryRow, ModuleMeta } from './types'

// 归属校验的共享口径：列表取数、概览待办、动作流转都只认这一处，避免两边各算各的。

// 所有业务模块通用的归属单位字段；示例数据播种与历史数据迁移也按这个键补齐。
export const OWNER_FIELD = '归属单位'

// 示例数据里使用的协作单位。
export const SURVEY_UNITS = ['省考古研究院调查一队', '省考古研究院调查二队', '高校联合考古队'] as const

// 其他模块（非调查模块）示例数据轮转归属，跨模块演示归属修正时用同一套口径。
const DEMO_UNITS = ['省考古研究院发掘一队', '省考古研究院发掘二队', '高校联合考古队'] as const

export function ownerFieldOf(meta: ModuleMeta): string {
  return meta.ownerField ?? OWNER_FIELD
}

export function rowOwner(meta: ModuleMeta, row: EntryRow): string {
  return String(row[ownerFieldOf(meta)] ?? '')
}

// 归档终态：任何模块「已归档」之后不再进入待办，也不允许再写。
export function isArchivedStatus(status: string): boolean {
  return status === '已归档'
}

// 待办口径：未归档且未办结。列表页与概览页共用，杜绝归档后在概览待办里重复出现。
export function isPendingRow(row: EntryRow): boolean {
  return !isArchivedStatus(String(row.status)) && Boolean(row.pending)
}

export function isOwner(meta: ModuleMeta, row: EntryRow, unit: string): boolean {
  const owner = rowOwner(meta, row)
  return owner.length > 0 && unit.length > 0 && owner === unit
}

// 示例数据归属的确定性分配：同一条记录在本地开发、构建预览、部署环境里结果完全一致。
export function defaultOwner(key: string, id: number): string {
  if (key === 'survey') {
    return SURVEY_UNITS[(id - 1) % SURVEY_UNITS.length]
  }
  return DEMO_UNITS[(id - 1) % DEMO_UNITS.length]
}

// 跨模块示例数据初始化 / 历史数据迁移的归属修正：只补缺，不覆盖；历史归档记录保持原归属。
export function ensureOwner(meta: ModuleMeta, row: EntryRow): EntryRow {
  const field = ownerFieldOf(meta)
  const current = String(row[field] ?? '').trim()
  if (current.length > 0) {
    return row
  }
  return { ...row, [field]: defaultOwner(meta.key, Number(row.id)) }
}
