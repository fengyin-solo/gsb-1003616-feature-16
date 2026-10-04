import { FLOW_RULES, FIREBELT_STATUS_FLAGS, availableActions, flowRuleFor } from '@/data/flows'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { syncFirebreakAfterReplant } from '@/api/replant-sync'
import type {
  ActionContext,
  ActionResult,
  BatchResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

function genBatchNo(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `PB${ymd}-${rand}`
}

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

// 登记了流转规则的模块（防火林带）走状态机：来源状态、角色、重复验收都在这里卡控。
// 数据每次都从 localStorage 直读，两个终端同时提交时按最新状态判定，只落一个结论。
function runFlowAction(key: string, id: number, action: string, context: ActionContext): ActionResult {
  const meta = moduleMeta(key)
  const rule = flowRuleFor(key, action)
  if (!rule) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (!rule.from.includes(current)) {
    if (action === '确认补植' && current === '完好') {
      return { ok: false, message: `${meta.entity}「${row['林带编号'] ?? id}」已验收为完好，重复验收只生效一次` }
    }
    const allowed = availableActions(key, current)
    return {
      ok: false,
      message: `当前状态「${current}」不能${action}，可执行：${allowed.join('、') || '无'}`,
    }
  }
  if (rule.roles && !rule.roles.includes(context.role ?? '')) {
    return { ok: false, message: rule.denyText ?? `当前角色「${context.role ?? '未知'}」无权${action}` }
  }
  const flags = FIREBELT_STATUS_FLAGS[rule.to] ?? { pending: true, abnormal: false }
  const updated: EntryRow = { ...row, status: rule.to, pending: flags.pending, abnormal: flags.abnormal }
  let batchNo = ''
  if (rule.needSpecies) {
    // 补植树种留空则沿用历史组成；与历史组成冲突时保留历史组成，补植树种只记在这里和台账
    updated['补植树种'] = (context.species ?? '').trim() || String(row['树种组成'] ?? '')
    updated['验收批次'] = ''
  }
  if (action === '确认补植') {
    batchNo = context.batchNo ?? genBatchNo()
    updated['验收批次'] = batchNo
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === 'firebelt' && action === '确认补植' && batchNo) {
    const sync = syncFirebreakAfterReplant(updated, context, batchNo)
    const suffix =
      sync.firebreakUpdated > 0
        ? `，已同步 ${sync.firebreakUpdated} 条隔离带维护批次「${batchNo}」并写入台账`
        : '，所属林区暂无隔离带需要同步，台账已写入'
    return { ok: true, message: `${meta.entity}已验收，当前状态「完好」${suffix}` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${rule.to}」` }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  context: ActionContext = {},
): ActionResult {
  if ((FLOW_RULES[key] ?? []).length > 0) {
    return runFlowAction(key, id, action, context)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 批量多选后整组一次提交：整组共享一个验收批次号，逐条校验，一次汇报。
// 每条独立判定（越权、状态不符、重复验收只影响对应那条），其余照常落库。
export function runBatchAction(
  key: string,
  ids: number[],
  action: string,
  context: ActionContext = {},
): BatchResult {
  if (ids.length === 0) {
    return { ok: false, message: '请先勾选要提交的记录', items: [] }
  }
  const batchNo = action === '确认补植' ? context.batchNo ?? genBatchNo() : context.batchNo
  const items = ids.map((id) => {
    const result = runAction(key, id, action, { ...context, batchNo })
    return { id, ok: result.ok, message: result.message }
  })
  const okCount = items.filter((item) => item.ok).length
  const failCount = items.length - okCount
  const parts = [`整组提交 ${items.length} 条：成功 ${okCount} 条`]
  if (failCount > 0) {
    parts.push(`拒绝 ${failCount} 条`)
  }
  if (batchNo && okCount > 0) {
    parts.push(`验收批次「${batchNo}」`)
  }
  return { ok: failCount === 0, message: parts.join('，'), items }
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
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
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
