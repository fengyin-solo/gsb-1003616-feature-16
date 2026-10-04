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

// 动作上下文：谁（角色/工号）在执行，补植树种、验收批次号由服务层消费
export type ActionContext = {
  operator?: string
  role?: string
  species?: string
  batchNo?: string
}

export type BatchItemResult = {
  id: number
  ok: boolean
  message: string
}

// 批量整组一次提交的结果：逐条结论 + 汇总
export type BatchResult = {
  ok: boolean
  message: string
  items: BatchItemResult[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
