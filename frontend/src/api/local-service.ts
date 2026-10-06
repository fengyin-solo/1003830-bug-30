import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { DEFAULT_UNIT, useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 当前单位：页面显式传入优先，没传时回落到会话里的值班单位。
function resolveUnit(unit?: string): string {
  if (unit) {
    return unit
  }
  try {
    return useSessionStore().unit
  } catch {
    return DEFAULT_UNIT
  }
}

// ---- 共享校验口径：列表页、概览页、动作流转都只用这一套，避免归属错位 ----

export function rowOwnerUnit(meta: ModuleMeta, row: EntryRow): string {
  return meta.ownerField ? String(row[meta.ownerField] ?? '') : ''
}

/** 归属校验：登记了归属单位的记录，只有原单位能执行动作，跨单位人员只能查看。 */
export function canOperateRow(meta: ModuleMeta, row: EntryRow, unit?: string): boolean {
  if (!meta.ownerField) {
    return true
  }
  const owner = rowOwnerUnit(meta, row)
  return owner !== '' && owner === resolveUnit(unit)
}

export function isRowArchived(row: EntryRow): boolean {
  return row.archived === true
}

/** 办结状态：缺省按 statuses 最后一个算，模块可在元数据里显式指定。 */
function doneStatuses(meta: ModuleMeta): string[] {
  return meta.doneStatuses ?? [meta.statuses[meta.statuses.length - 1]]
}

/** 待办口径：未归档、且当前状态不是办结状态。归档记录永远不再进入待办。 */
export function computePending(meta: ModuleMeta, status: string, archived: boolean): boolean {
  return !archived && !doneStatuses(meta).includes(status)
}

/** 概览待办取数口径：待办且归属当前单位（无归属字段的模块不按单位过滤）。 */
export function isTodoRow(meta: ModuleMeta, row: EntryRow, unit?: string): boolean {
  if (!row.pending || isRowArchived(row)) {
    return false
  }
  if (!meta.ownerField) {
    return true
  }
  return rowOwnerUnit(meta, row) === resolveUnit(unit)
}

type GuardResult = { ok: boolean; message: string }

const GUARD_OK: GuardResult = { ok: true, message: '' }

// 动作校验：归属、归档、单向推进、重复归档都拦在这里，runAction 和列表页共用。
function checkAction(
  meta: ModuleMeta,
  row: EntryRow,
  action: string,
  rows: EntryRow[],
  unit?: string,
): GuardResult {
  if (!meta.actions.includes(action)) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const owner = rowOwnerUnit(meta, row)
  if (!canOperateRow(meta, row, unit)) {
    return {
      ok: false,
      message: `该${meta.entity}归属「${owner || '其他单位'}」，跨单位人员只能查看，不能执行「${action}」`,
    }
  }
  if (isRowArchived(row)) {
    return { ok: false, message: `该${meta.entity}已归档，不能再执行「${action}」` }
  }
  if (action === meta.archiveAction) {
    const current = String(row.status)
    if (!doneStatuses(meta).includes(current)) {
      return {
        ok: false,
        message: `该${meta.entity}当前状态「${current}」，须按「${meta.statuses.join('→')}」推进到「${doneStatuses(meta).join('、')}」后才能${action}`,
      }
    }
    // 并发/重复归档按调查编号去重：同一编号只保留先成功的一次，后到请求明确拒绝。
    const codeField = meta.fields[0]
    const code = String(row[codeField] ?? row.id)
    const duplicated = rows.some(
      (item) => Number(item.id) !== Number(row.id) && String(item[codeField] ?? '') === code && isRowArchived(item),
    )
    if (duplicated) {
      return { ok: false, message: `调查编号「${code}」已归档，后到的归档请求已拒绝` }
    }
    return GUARD_OK
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const current = String(row.status)
  if (meta.oneWay) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (targetIndex !== currentIndex + 1) {
      return {
        ok: false,
        message: `${meta.entity}状态须按「${meta.statuses.join('→')}」单向推进，当前「${current}」不能执行「${action}」`,
      }
    }
    return GUARD_OK
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  return GUARD_OK
}

/** 列表页按行渲染动作：只返回当前单位、当前状态下真正可执行的动作。 */
export function allowedActions(meta: ModuleMeta, row: EntryRow, unit: string, rows: EntryRow[]): string[] {
  if (isRowArchived(row) || !canOperateRow(meta, row, unit)) {
    return []
  }
  return meta.actions.filter((action) => checkAction(meta, row, action, rows, unit).ok)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, unit?: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const guard = checkAction(meta, rows[index], action, rows, unit)
  if (!guard.ok) {
    return { ok: false, message: guard.message }
  }
  const next = [...rows]
  if (action === meta.archiveAction) {
    const codeField = meta.fields[0]
    const code = String(rows[index][codeField] ?? id)
    next[index] = {
      ...rows[index],
      archived: true,
      pending: false,
      归档日期: new Date().toISOString().slice(0, 10),
    }
    saveRows(key, next)
    return { ok: true, message: `${meta.entity}已归档，调查编号「${code}」的后续归档请求将被拒绝` }
  }
  const target = meta.actionTargets[action]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: computePending(meta, target, false),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(unit?: string): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => isTodoRow(meta, row, unit)).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
