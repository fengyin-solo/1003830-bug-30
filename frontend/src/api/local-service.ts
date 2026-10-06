import { MODULE_BY_KEY } from '@/data/modules'
import { freshRows, allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  isArchivedStatus,
  isOwner,
  isPendingRow,
  rowOwner,
} from '@/data/ownership'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 同一记录归档串行处理的在途锁：先成功的一次落库，后到的请求明确拒绝。
const archiveInFlight = new Set<string>()

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
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

// 某条记录在当前单位下可执行的动作：跨单位人员只读（不返回任何动作）。
export function availableActions(meta: ModuleMeta, row: EntryRow, unit: string): string[] {
  if (!isOwner(meta, row, unit)) {
    return []
  }
  const status = String(row.status)
  if (isArchivedStatus(status)) {
    return []
  }
  if (!meta.strictFlow) {
    return meta.actions.filter((action) => meta.actionTargets[action] !== status)
  }
  const currentIndex = meta.statuses.indexOf(status)
  return meta.actions.filter((action) => {
    const targetIndex = meta.statuses.indexOf(meta.actionTargets[action])
    if (targetIndex < 0) {
      return false
    }
    // 严格单向：常规动作只允许推进到相邻下一状态；归档动作允许从复核后两个状态进入终态。
    if (isArchivedStatus(meta.actionTargets[action])) {
      return currentIndex === 2 || currentIndex === 3
    }
    return targetIndex === currentIndex + 1
  })
}

export function runAction(key: string, id: number, action: string, unit = ''): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  const isArchive = isArchivedStatus(target)
  const lockKey = isArchive ? `${key}:${id}` : ''

  if (isArchive && archiveInFlight.has(lockKey)) {
    return { ok: false, message: `该${meta.entity}正在归档，请勿重复提交；只保留先成功的一次归档` }
  }

  if (isArchive) {
    archiveInFlight.add(lockKey)
    try {
      return commitAction(meta, key, id, action, target, unit)
    } finally {
      archiveInFlight.delete(lockKey)
    }
  }
  return commitAction(meta, key, id, action, target, unit)
}

function commitAction(
  meta: ModuleMeta,
  key: string,
  id: number,
  action: string,
  target: string,
  unit: string,
): ActionResult {
  // 归档路径重新取数：拿持久化里的最新状态，杜绝并发下用过期快照重复归档。
  const rows = isArchivedStatus(target) ? freshRows(key) : listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]
  const currentStatus = String(current.status)

  if (unit.length > 0 && !isOwner(meta, current, unit)) {
    return {
      ok: false,
      message: `该${meta.entity}归属「${rowOwner(meta, current)}」，跨单位人员只能查看，不能${action}`,
    }
  }

  if (isArchivedStatus(currentStatus)) {
    return { ok: false, message: `该${meta.entity}已归档，历史归档记录保持原归属，不能再操作` }
  }

  if (currentStatus === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  if (meta.strictFlow) {
    const currentIndex = meta.statuses.indexOf(currentStatus)
    const targetIndex = meta.statuses.indexOf(target)
    if (currentIndex < 0 || targetIndex < 0) {
      return { ok: false, message: `${meta.entity}状态「${currentStatus}」不在登记的流转范围内` }
    }
    if (isArchivedStatus(target)) {
      // 已复核、需复查之后才能归档；其他状态提前归档一律拒绝。
      if (currentIndex !== 2 && currentIndex !== 3) {
        return {
          ok: false,
          message: `${meta.entity}复核通过后才能归档，当前「${currentStatus}」不能直接归档`,
        }
      }
    } else if (targetIndex !== currentIndex + 1) {
      // 调查中 → 已记录 → 已复核 → 需复查，只能单向推进，不能跳步也不能回退。
      return {
        ok: false,
        message: `${meta.entity}状态只能单向推进，不能从「${currentStatus}」${action}到「${target}」`,
      }
    }
  }

  const updated: EntryRow = {
    ...current,
    status: target,
    pending: !isArchivedStatus(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
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

// 概览与列表共用的待办口径：未归档且 pending 才算待办，归档记录不会在概览待办里重复出现。
export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => isPendingRow(row)).length,
      abnormal: entries.filter((row) => row.abnormal).length,
      archived: entries.filter((row) => isArchivedStatus(String(row.status))).length,
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
