import { SEED_ROWS } from './seed'
import type { EntryRow, IdemRecord } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：防火林带状态机、补植批次与隔离带维护台账在这一版落库。
const STORAGE_KEY = 'forest-fire-patrol:entries:v2'
const IDEM_KEY = 'forest-fire-patrol:idempotency'

// 跨标签页（两个终端）数据变更广播：localStorage 的 storage 事件只在其他标签触发，
// 同标签页提交后用自定义事件再通知一次，两边都监听同一个事件名即可。
export const DATA_CHANGED_EVENT = 'forest-fire-patrol:data-changed'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 只拿种子里登记过的模块，避免旧版本脏数据混进来；缺模块自动回补。
    const merged = clone(fallback)
    for (const key of Object.keys(merged)) {
      if (Array.isArray(parsed[key])) {
        merged[key] = parsed[key]
      }
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

function broadcast(keys: string[]): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { keys } }))
  }
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 另一个终端写入后（storage 事件），丢弃本页缓存重新读盘，保证看到的是同一份结论。
export function syncFromStorage(keys?: string[]): string[] {
  const changed = keys ?? Object.keys(allRows())
  cache = readStorage()
  broadcast(changed)
  return changed
}

export function saveRows(key: string, rows: EntryRow[]): void {
  saveMany({ [key]: rows })
}

// 批量多选整组一次提交：所有模块在同一次写入里落库，要么整组生效，要么不动。
export function saveMany(patch: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patch }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先读磁盘上的最新整包再合并，避免两个终端各自基于旧快照写入时互相覆盖。
    const disk = readStorage()
    const merged = { ...disk, ...patch }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  }
  broadcast(Object.keys(patch))
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 幂等令牌：验收/批量提交携带令牌，命中已落库的结论就直接返回，重复验收只生效一次。
export function readIdempotency(): Record<string, IdemRecord> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    return JSON.parse(window.localStorage.getItem(IDEM_KEY) ?? '{}') as Record<string, IdemRecord>
  } catch {
    return {}
  }
}

export function takeIdempotency(token: string): IdemRecord | null {
  return readIdempotency()[token] ?? null
}

export function putIdempotency(token: string, record: IdemRecord): void {
  if (typeof window === 'undefined' || !window.localStorage || !token) {
    return
  }
  const records = readIdempotency()
  // 已有结论绝不覆盖：保证任何终端重复提交都只落第一个结论。
  if (records[token]) {
    return
  }
  records[token] = record
  window.localStorage.setItem(IDEM_KEY, JSON.stringify(records))
}
