import { SEED_ROWS } from './seed'
import { MODULE_BY_KEY } from './modules'
import { ensureOwner, isArchivedStatus } from './ownership'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
// 归属口径版本：只升不回。旧版本数据读出来后走同一份迁移，再写回。
const SCHEMA_KEY = 'field-archaeology-digital:schema-version'
const SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 历史数据迁移：状态口径更名、归属补齐、归档后待办归一。
// 归属只补缺、不覆盖，历史归档调查记录保持原归属。
function normalizeRows(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return rows
  }
  return rows.map((raw) => {
    let row = { ...raw }
    if (key === 'survey' && row.status === '已审核') {
      row = { ...row, status: '已复核' }
    }
    row = ensureOwner(meta, row)
    if (isArchivedStatus(String(row.status)) && row.pending) {
      row = { ...row, pending: false }
    }
    return row
  })
}

function normalizeAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  return Object.fromEntries(
    Object.entries(data).map(([key, rows]) => [key, normalizeRows(key, rows ?? [])]),
  )
}

function seedData(): Record<string, EntryRow[]> {
  return normalizeAll(clone(SEED_ROWS))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedData()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const version = Number(window.localStorage.getItem(SCHEMA_KEY) ?? '1')
    // 以播种数据为底：新模块、新字段始终可用；再叠加浏览器里已有模块的改动。
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    const next = version >= SCHEMA_VERSION ? merged : normalizeAll(merged)
    if (version < SCHEMA_VERSION) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    }
    return next
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return fallback
  }
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

// 归档等关键动作写入前重新读一次持久化数据，避免用过期快照把并发请求重复落库。
export function freshRows(key: string): EntryRow[] {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
        if (Array.isArray(parsed[key])) {
          cache = { ...allRows(), ...parsed }
          return parsed[key]
        }
      } catch {
        // 落库内容损坏时回到内存缓存，交由常规流程处理
      }
    }
  }
  return listRows(key)
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = normalizeRows(key, clone(SEED_ROWS[key] ?? []))
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
