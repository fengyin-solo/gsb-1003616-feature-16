import { listRows, saveRows } from '@/data/local-store'
import type { ActionContext, EntryRow } from '@/data/types'

export type ReplantSyncResult = {
  firebreakUpdated: number
  ledgerAppended: boolean
}

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 补植验收通过后的联动：
// 1) 同林区的防火隔离带写入维护批次、最近维护日期，维护状态回到「正常」；
// 2) 隔离带维护台账追加一条批次记录（按批次号+林带编号幂等，重复验收不会重复入账）。
// 树种冲突的保留方式：历史「树种组成」不动，补植树种只落在台账与林带行的补植字段里。
export function syncFirebreakAfterReplant(
  belt: EntryRow,
  context: ActionContext,
  batchNo: string,
): ReplantSyncResult {
  const today = nowText().slice(0, 10)
  const district = String(belt['所属林区'] ?? '')
  const history = String(belt['树种组成'] ?? '')
  const species = String(belt['补植树种'] ?? '').trim() || history
  const conflict = species !== '' && history !== '' && species !== history

  const breaks = listRows('firebreak')
  let firebreakUpdated = 0
  const nextBreaks = breaks.map((row) => {
    if (String(row['所属林区'] ?? '') !== district) {
      return row
    }
    firebreakUpdated += 1
    return {
      ...row,
      status: '正常',
      pending: false,
      abnormal: false,
      维护状态: '正常',
      最近维护日期: today,
      植被恢复程度: `补植验收通过（${species || '沿用历史组成'}）`,
      维护批次: batchNo,
    }
  })
  if (firebreakUpdated > 0) {
    saveRows('firebreak', nextBreaks)
  }

  const ledger = listRows('firebreakledger')
  const beltCode = String(belt['林带编号'] ?? '')
  const exists = ledger.some(
    (row) => String(row['批次号']) === batchNo && String(row['林带编号']) === beltCode,
  )
  if (!exists) {
    const id = ledger.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const record: EntryRow = {
      id,
      status: '已生效',
      pending: false,
      abnormal: false,
      批次号: batchNo,
      林带编号: beltCode,
      所属林区: district,
      补植树种: species,
      历史组成: history,
      验收结论: conflict ? '验收通过（补植树种与历史组成不一致，保留历史组成）' : '验收通过',
      验收人: context.operator ?? '',
      验收时间: nowText(),
    }
    saveRows('firebreakledger', [...ledger, record])
  }

  return { firebreakUpdated, ledgerAppended: !exists }
}
