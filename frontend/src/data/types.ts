/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 角色：普通巡护只能发现缺株、安排补植；验收/管理员才能验收补植、归档退化。
export type RoleKey = 'patrol' | 'acceptance' | 'admin'

export type RoleOption = {
  key: RoleKey
  label: string
}

// 防火林带的流转追踪记录：每次状态推进都落一条，流程可追踪。
export type FlowTraceEntry = {
  time: string
  action: string
  operator: string
  role: string
  detail?: string
}

// 防火隔离带维护台账条目：林带补植验收合格后同步追加。
export type FirebreakLedgerEntry = {
  time: string
  batchNo: string
  beltNo: string
  region: string
  species: string
  result: string
  acceptor: string
}

// 幂等记录：同一提交令牌在任意终端都只落一个结论。
export type IdemRecord = {
  at: string
  ok: boolean
  message: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]:
    | string
    | number
    | boolean
    | FlowTraceEntry[]
    | FirebreakLedgerEntry[]
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
  batchNo?: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
