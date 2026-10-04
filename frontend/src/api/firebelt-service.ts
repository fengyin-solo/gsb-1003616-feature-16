import {
  listRows,
  putIdempotency,
  saveMany,
  takeIdempotency,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FirebreakLedgerEntry,
  FlowTraceEntry,
  RoleKey,
} from '@/data/types'

// 防火林带状态机 + 防火隔离带维护联动：
// 完好 --发现缺株--> 有缺株 --安排补植--> 需补植 --验收合格--> 完好
//                                              └验收不合格--> 留在需补植
// 需补植 --（验收员/管理员，补植无望）--> 已退化（终态，普通巡护不得直接归档）

const FIREBELT = 'firebelt'
const FIREBREAK = 'firebreak'

export const FIREBELT_STATUSES = ['完好', '有缺株', '需补植', '已退化'] as const

type SubmitOptions = {
  ids: number[]
  operator: string
  role: RoleKey
  token: string
}

type ArrangeOptions = SubmitOptions & {
  species: string
}

type AcceptOptions = SubmitOptions & {
  passed: boolean
  comment: string
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function traces(row: EntryRow): FlowTraceEntry[] {
  const value = row['流转记录']
  return Array.isArray(value) ? (value as FlowTraceEntry[]) : []
}

function ledger(row: EntryRow): FirebreakLedgerEntry[] {
  const value = row['维护台账']
  return Array.isArray(value) ? (value as FirebreakLedgerEntry[]) : []
}

function roleName(role: RoleKey): string {
  return role === 'patrol' ? '普通巡护员' : role === 'acceptance' ? '补植验收员' : '防火管理员'
}

function isYear(value: unknown): boolean {
  return /^(19|20)\d{2}$/.test(String(value ?? '').trim())
}

/**
 * 老林带缺种植年份时按所属林区兼容：
 * 取同一林区内已知最早种植年份；同林区也没有，再退回全部林带的最早年份。
 */
export function effectivePlantingYear(row: EntryRow, rows: EntryRow[] = listRows(FIREBELT)): {
  year: string
  compatible: boolean
} {
  const raw = String(row['种植年份'] ?? '').trim()
  if (isYear(raw)) {
    return { year: raw, compatible: false }
  }
  const region = String(row['所属林区'] ?? '')
  const yearsOfRegion = rows
    .filter((item) => String(item['所属林区'] ?? '') === region && isYear(item['种植年份']))
    .map((item) => Number(String(item['种植年份']).trim()))
  let pool = yearsOfRegion
  if (pool.length === 0) {
    pool = rows
      .filter((item) => Number(item.id) !== Number(row.id) && isYear(item['种植年份']))
      .map((item) => Number(String(item['种植年份']).trim()))
  }
  if (pool.length === 0) {
    return { year: raw || '待考证', compatible: true }
  }
  return { year: String(Math.min(...pool)), compatible: true }
}

/**
 * 补植树种与历史组成冲突时的保留方式（统一在这决定）：
 * 历史组成原样保留，补植树种按「2026补植：木荷」追加，不覆盖原始结构；
 * 同一树种同一年度已补过则不重复追加。
 */
export function mergeSpecies(history: string, planted: string, year: string): string {
  let merged = history.trim()
  const additions = planted
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  for (const name of additions) {
    const tag = `${year}补植：${name}`
    if (!merged.includes(tag)) {
      merged = `${merged}；${tag}`
    }
  }
  return merged
}

// 批次号 WH-YYYY-MM-NNN：扫隔离带台账与林带补植批次取当月最大序号再加一。
function nextBatchNo(belts: EntryRow[], breaks: EntryRow[], time: string): string {
  const monthKey = time.slice(0, 7) // YYYY-MM
  let max = 0
  for (const belt of belts) {
    const value = String(belt['补植批次'] ?? '')
    const prefix = `WH-${monthKey}-`
    if (value.startsWith(prefix)) {
      max = Math.max(max, Number(value.slice(prefix.length)) || 0)
    }
  }
  for (const item of breaks) {
    for (const entry of ledger(item)) {
      const prefix = `WH-${monthKey}-`
      if (entry.batchNo.startsWith(prefix)) {
        max = Math.max(max, Number(entry.batchNo.slice(prefix.length)) || 0)
      }
    }
  }
  return `WH-${monthKey}-${String(max + 1).padStart(3, '0')}`
}

function requireRows(ids: number[], rows: EntryRow[]): { row?: EntryRow; index: number }[] {
  return ids.map((id) => {
    const index = rows.findIndex((row) => Number(row.id) === Number(id))
    return { row: index < 0 ? undefined : rows[index], index }
  })
}

// 发现缺株：只有完好林带能上报；任何角色都可以（巡护的本职）。
export function reportGaps(options: SubmitOptions & { detail: string }): ActionResult {
  if (!options.ids.length) {
    return { ok: false, message: '请先勾选发现缺株的林带' }
  }
  const cached = takeIdempotency(options.token)
  if (cached) {
    return { ok: false, message: `该发现缺株提交已处理过，未重复落库：${cached.message}` }
  }
  const belts = listRows(FIREBELT)
  const found = requireRows(options.ids, belts)
  const missing = found.some((item) => item.index < 0)
  if (missing) {
    const result = { ok: false, message: '存在已不存在的林带，整组未提交' }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const illegal = found.find((item) => String(item.row!.status) !== '完好')
  if (illegal) {
    const result = {
      ok: false,
      message: `林带 ${illegal.row!['林带编号']} 当前为「${illegal.row!.status}」，只有完好林带能发现缺株`,
    }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const time = nowText()
  const nextBelts = [...belts]
  for (const item of found) {
    const row = item.row!
    nextBelts[item.index] = {
      ...row,
      status: '有缺株',
      pending: true,
      abnormal: true,
      流转记录: [
        ...traces(row),
        { time, action: '发现缺株', operator: options.operator, role: roleName(options.role), detail: options.detail || '巡护发现缺株' },
      ],
    }
  }
  saveMany({ [FIREBELT]: nextBelts })
  const result = { ok: true, message: `${found.length} 条林带已上报缺株，只能进入补植流程` }
  putIdempotency(options.token, { at: time, ...result })
  return result
}

// 安排补植：缺株后只能进入补植；整组共用一个批次号，一次提交落库。
export function arrangeReplant(options: ArrangeOptions): ActionResult {
  if (!options.ids.length) {
    return { ok: false, message: '请先勾选要安排补植的林带' }
  }
  if (!options.species.trim()) {
    return { ok: false, message: '补植树种不能为空' }
  }
  const cached = takeIdempotency(options.token)
  if (cached) {
    return { ok: false, message: `该补植安排已提交过，未重复落库：${cached.message}` }
  }
  const belts = listRows(FIREBELT)
  const found = requireRows(options.ids, belts)
  if (found.some((item) => item.index < 0)) {
    const result = { ok: false, message: '存在已不存在的林带，整组未提交' }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  // 发现缺株后只能进入补植：已退化终态、需补植在途、完好未发现缺株都不允许。
  const illegal = found.find((item) => String(item.row!.status) !== '有缺株')
  if (illegal) {
    const row = illegal.row!
    const hint =
      String(row.status) === '已退化'
        ? '已退化林带不得再安排补植，按重建计划处理'
        : String(row.status) === '需补植'
          ? '该林带已在补植批次中，等待验收，不能重复安排'
          : '完好林带须先发现缺株，再安排补植'
    const result = { ok: false, message: `林带 ${row['林带编号']}：${hint}` }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const breaks = listRows(FIREBREAK)
  const time = nowText()
  const batchNo = nextBatchNo(belts, breaks, time)
  const nextBelts = [...belts]
  for (const item of found) {
    const row = item.row!
    nextBelts[item.index] = {
      ...row,
      status: '需补植',
      pending: true,
      abnormal: false,
      补植批次: batchNo,
      补植树种: options.species.trim(),
      流转记录: [
        ...traces(row),
        {
          time,
          action: '安排补植',
          operator: options.operator,
          role: roleName(options.role),
          detail: `批次 ${batchNo}，补植树种：${options.species.trim()}`,
        },
      ],
    }
  }
  saveMany({ [FIREBELT]: nextBelts })
  const result = { ok: true, message: `已安排补植，批次 ${batchNo}，共 ${found.length} 条林带`, batchNo }
  putIdempotency(options.token, { at: time, ...result })
  return result
}

// 把验收合格的补植结果同步到同林区防火隔离带：维护状态、最近维护日期、维护台账各加一条批次。
function syncFirebreaks(
  breaks: EntryRow[],
  accepted: { row: EntryRow; species: string }[],
  entry: { time: string; batchNo: string; acceptor: string },
): EntryRow[] {
  if (!accepted.length) {
    return breaks
  }
  const regions = new Set(accepted.map((item) => String(item.row['所属林区'] ?? '')))
  const date = entry.time.slice(0, 10)
  return breaks.map((item) => {
    if (!regions.has(String(item['所属林区'] ?? ''))) {
      return item
    }
    const regionAccepted = accepted.filter((a) => String(a.row['所属林区'] ?? '') === String(item['所属林区'] ?? ''))
    const newEntries: FirebreakLedgerEntry[] = regionAccepted.map((a) => ({
      time: entry.time,
      batchNo: entry.batchNo,
      beltNo: String(a.row['林带编号'] ?? ''),
      region: String(a.row['所属林区'] ?? ''),
      species: a.species,
      result: '验收合格',
      acceptor: entry.acceptor,
    }))
    const beltNos = regionAccepted.map((a) => String(a.row['林带编号'] ?? '')).join('、')
    return {
      ...item,
      status: '正常',
      pending: true,
      abnormal: false,
      最近维护日期: date,
      植被恢复程度: '补植恢复良好',
      补植批次: entry.batchNo,
      维护状态: `已同步补植批次 ${entry.batchNo}（${beltNos}）`,
      维护台账: [...ledger(item), ...newEntries],
    }
  })
}

// 验收补植：越权（普通巡护）拒绝；重复验收只生效一次；合格才回完好并同步隔离带台账。
export function acceptReplant(options: AcceptOptions): ActionResult {
  if (!options.ids.length) {
    return { ok: false, message: '请先勾选待验收的林带' }
  }
  if (options.role === 'patrol') {
    return { ok: false, message: '越权操作被拒绝：普通巡护员无权验收补植，请由补植验收员或管理员验收' }
  }
  const cached = takeIdempotency(options.token)
  if (cached) {
    return {
      ok: false,
      batchNo: cached.message.match(/批次 (WH-\d{4}-\d{2}-\d{3})/)?.[1],
      message: `重复验收只生效一次，未重复落库：${cached.message}`,
    }
  }
  const belts = listRows(FIREBELT)
  const found = requireRows(options.ids, belts)
  if (found.some((item) => item.index < 0)) {
    const result = { ok: false, message: '存在已不存在的林带，整组未提交' }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const notPending = found.find((item) => String(item.row!.status) !== '需补植')
  if (notPending) {
    const row = notPending.row!
    const hint =
      String(row.status) === '完好'
        ? '该林带已验收合格回到完好，不能重复验收'
        : String(row.status) === '已退化'
          ? '该林带已归档退化，不能验收'
          : '该林带尚未进入补植，无批次可验收'
    const result = { ok: false, message: `林带 ${row['林带编号']}：${hint}` }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const batchNos = [...new Set(found.map((item) => String(item.row!['补植批次'] ?? '')))]
  if (batchNos.length !== 1 || !batchNos[0]) {
    const result = { ok: false, message: '整组一次提交只能验收同一补植批次的林带，请按批次分组勾选' }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const batchNo = batchNos[0]
  const time = nowText()
  const year = time.slice(0, 4)
  const nextBelts = [...belts]
  const accepted: { row: EntryRow; species: string }[] = []
  for (const item of found) {
    const row = item.row!
    if (options.passed) {
      const historySpecies = String(row['树种组成'] ?? '')
      const plantedSpecies = String(row['补植树种'] ?? '').trim()
      const mergedSpecies = mergeSpecies(historySpecies, plantedSpecies, year)
      accepted.push({ row, species: plantedSpecies })
      nextBelts[item.index] = {
        ...row,
        status: '完好',
        pending: true,
        abnormal: false,
        树种组成: mergedSpecies,
        林带状态: `补植验收合格（${batchNo}）`,
        流转记录: [
          ...traces(row),
          {
            time,
            action: '验收补植',
            operator: options.operator,
            role: roleName(options.role),
            detail: `验收合格，批次 ${batchNo}；树种组成按「保留历史+补植追加」更新${options.comment ? `；${options.comment}` : ''}`,
          },
        ],
      }
    } else {
      // 验收不合格：留在需补植，等整改后重新验收，不动隔离带台账。
      nextBelts[item.index] = {
        ...row,
        status: '需补植',
        pending: true,
        abnormal: true,
        流转记录: [
          ...traces(row),
          {
            time,
            action: '验收补植',
            operator: options.operator,
            role: roleName(options.role),
            detail: `验收不合格，批次 ${batchNo}，退回整改${options.comment ? `：${options.comment}` : ''}`,
          },
        ],
      }
    }
  }
  const breaks = listRows(FIREBREAK)
  const nextBreaks = options.passed
    ? syncFirebreaks(breaks, accepted, { time, batchNo, acceptor: options.operator })
    : breaks
  saveMany({ [FIREBELT]: nextBelts, [FIREBREAK]: nextBreaks })
  const result = options.passed
    ? {
        ok: true,
        batchNo,
        message: `批次 ${batchNo} 验收合格，${accepted.length} 条林带回到完好，已同步更新同林区防火隔离带维护台账`,
      }
    : { ok: true, batchNo, message: `批次 ${batchNo} 验收不合格，林带留在「需补植」并记录退回原因，隔离带台账不更新` }
  putIdempotency(options.token, { at: time, ...result })
  return result
}

// 标记退化：普通巡护不得直接归档；且必须在补植环节（需补植）之后才能归档。
export function markDegraded(options: SubmitOptions & { reason: string }): ActionResult {
  if (!options.ids.length) {
    return { ok: false, message: '请先勾选要归档退化的林带' }
  }
  if (options.role === 'patrol') {
    return { ok: false, message: '越权操作被拒绝：退化归档不得由普通巡护直接办理，请由补植验收员或管理员确认' }
  }
  const cached = takeIdempotency(options.token)
  if (cached) {
    return { ok: false, message: `该退化归档已提交过，未重复落库：${cached.message}` }
  }
  const belts = listRows(FIREBELT)
  const found = requireRows(options.ids, belts)
  if (found.some((item) => item.index < 0)) {
    const result = { ok: false, message: '存在已不存在的林带，整组未提交' }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const illegal = found.find((item) => {
    const status = String(item.row!.status)
    return status !== '需补植'
  })
  if (illegal) {
    const row = illegal.row!
    const hint =
      String(row.status) === '已退化'
        ? '该林带已归档退化'
        : '退化只能在补植环节确认（须先发现缺株并安排补植），不得由完好/缺株直接归档'
    const result = { ok: false, message: `林带 ${row['林带编号']}：${hint}` }
    putIdempotency(options.token, { at: nowText(), ...result })
    return result
  }
  const time = nowText()
  const nextBelts = [...belts]
  for (const item of found) {
    const row = item.row!
    nextBelts[item.index] = {
      ...row,
      status: '已退化',
      pending: false,
      abnormal: true,
      林带状态: `已归档退化（${row['补植批次'] || '无批次'}）`,
      流转记录: [
        ...traces(row),
        {
          time,
          action: '标记退化',
          operator: options.operator,
          role: roleName(options.role),
          detail: options.reason || '补植后仍无法恢复，归档为已退化，纳入重建计划',
        },
      ],
    }
  }
  saveMany({ [FIREBELT]: nextBelts })
  const result = { ok: true, message: `${found.length} 条林带已归档为已退化（终态）` }
  putIdempotency(options.token, { at: time, ...result })
  return result
}

export function firebeltStats() {
  const rows = listRows(FIREBELT)
  return {
    total: rows.length,
    intact: rows.filter((row) => String(row.status) === '完好').length,
    gaps: rows.filter((row) => String(row.status) === '有缺株').length,
    replanting: rows.filter((row) => String(row.status) === '需补植').length,
    degraded: rows.filter((row) => String(row.status) === '已退化').length,
  }
}
