import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
// 示例数据版本：归属修正随版本一起下发，本地开发、构建预览、部署环境拿到的是同一份初始化结果。
const VERSION_KEY = 'field-archaeology-digital:version'
const SEED_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 版本升级时的迁移：以新示例数据为准（含归属修正），但历史归档的调查记录原样保留，
// 归属单位、归档标记都不改写；旧版里「已审核」即事实上的归档，迁移为「已复核 + 已归档」。
function migrate(stored: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const base = clone(SEED_ROWS)
  const seededCodes = new Set((base.survey ?? []).map((row) => String(row['调查编号'] ?? '')))
  const preserved = (stored.survey ?? [])
    .filter((row) => row.archived === true || row.status === '已审核')
    .filter((row) => !seededCodes.has(String(row['调查编号'] ?? '')))
    .map((row) => ({
      ...row,
      status: row.status === '已审核' ? '已复核' : row.status,
      archived: true,
      pending: false,
    }))
  return { ...base, survey: [...(base.survey ?? []), ...preserved] }
}

function writeStorage(rows: Record<string, EntryRow[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  window.localStorage.setItem(VERSION_KEY, String(SEED_VERSION))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const version = window.localStorage.getItem(VERSION_KEY)
  if (!raw) {
    writeStorage(fallback)
    return fallback
  }
  let parsed: Record<string, EntryRow[]> = {}
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    writeStorage(fallback)
    return fallback
  }
  if (version !== String(SEED_VERSION)) {
    const merged = migrate(parsed)
    writeStorage(merged)
    return merged
  }
  return { ...fallback, ...parsed }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
