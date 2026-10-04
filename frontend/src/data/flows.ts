import type { EntryRow } from './types'

// 防火林带的可追踪流转：发现缺株只能进补植，验收成功才回完好，退化归档受角色限制。
// 页面只负责展示，能不能转、谁来转，全部以这里的规则 + local-service 的校验为准。
export type FlowRule = {
  action: string
  from: string[]
  to: string
  /** 允许执行的角色；缺省表示任何角色都可以 */
  roles?: string[]
  /** 该动作需要登记补植树种（留空则沿用历史组成） */
  needSpecies?: boolean
  /** 越权时的拒绝文案 */
  denyText?: string
}

export const FLOW_RULES: Record<string, FlowRule[]> = {
  firebelt: [
    { action: '发现缺株', from: ['完好'], to: '有缺株' },
    { action: '安排补植', from: ['有缺株', '已退化'], to: '需补植', needSpecies: true },
    {
      action: '确认补植',
      from: ['需补植'],
      to: '完好',
      roles: ['验收员', '管理员'],
      denyText: '越权验收已拒绝：补植验收需验收员或管理员执行',
    },
    {
      action: '标记退化',
      from: ['完好', '需补植'],
      to: '已退化',
      roles: ['管理员'],
      denyText: '退化不得由普通巡护直接归档，需管理员确认',
    },
  ],
}

export function flowRulesFor(key: string): FlowRule[] {
  return FLOW_RULES[key] ?? []
}

export function flowRuleFor(key: string, action: string): FlowRule | undefined {
  return flowRulesFor(key).find((rule) => rule.action === action)
}

// 当前状态下允许尝试的动作（角色校验在服务层做，越权会被拒绝并提示）
export function availableActions(key: string, status: string): string[] {
  return flowRulesFor(key)
    .filter((rule) => rule.from.includes(status))
    .map((rule) => rule.action)
}

// 林带各状态的待办/异常标记：完好、已退化为终态，其余需要跟进
export const FIREBELT_STATUS_FLAGS: Record<string, { pending: boolean; abnormal: boolean }> = {
  完好: { pending: false, abnormal: false },
  有缺株: { pending: true, abnormal: true },
  需补植: { pending: true, abnormal: false },
  已退化: { pending: false, abnormal: true },
}

// 老林带缺种植年份时，按所属林区其他林带的年份兼容补齐（取同林区出现最多、并列取最早的年份）
export function resolvePlantYear(
  row: EntryRow,
  belts: EntryRow[],
): { year: string; inferred: boolean } {
  const raw = String(row['种植年份'] ?? '').trim()
  if (/\d{4}/.test(raw)) {
    return { year: raw, inferred: false }
  }
  const district = String(row['所属林区'] ?? '').trim()
  const counts = new Map<string, number>()
  for (const belt of belts) {
    if (String(belt['所属林区'] ?? '').trim() !== district) {
      continue
    }
    const year = String(belt['种植年份'] ?? '').trim()
    if (!/\d{4}/.test(year)) {
      continue
    }
    counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [year, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === '' || year < best))) {
      best = year
      bestCount = count
    }
  }
  return best ? { year: best, inferred: true } : { year: '', inferred: false }
}
