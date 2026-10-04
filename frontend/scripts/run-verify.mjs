// 防火林带状态机自检：node scripts/run-verify.mjs
// 两次打包到不同目录，模拟「两个终端」，共用同一个内存 localStorage。
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

class MemoryStorage {
  constructor(map = new Map()) { this.map = map }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(key, value) }
}

const shared = new Map()
function installWindow() {
  const listeners = new Set()
  globalThis.window = {
    localStorage: new MemoryStorage(shared),
    CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail } },
    addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn),
    dispatchEvent: (event) => { listeners.forEach((fn) => fn(event)) },
  }
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `tok-${Math.random().toString(16).slice(2)}` },
    configurable: true,
  })
}
installWindow()

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}
let tokenSeq = 0
const tok = () => `token-${++tokenSeq}`

async function makeTerminal() {
  const dir = mkdtempSync(join(tmpdir(), 'belt-'))
  const outfile = join(dir, 'api.mjs')
  await build({
    entryPoints: ['scripts/verify-entry.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    alias: { '@': join(process.cwd(), 'src') },
    outfile,
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

const A = await makeTerminal()
const B = await makeTerminal()

const patrol = { role: 'patrol', operator: '周巡护' }
const acceptor = { role: 'acceptance', operator: '王验收' }
const admin = { role: 'admin', operator: '管理员' }

function belt(api, id) {
  return api.listRows('firebelt').find((r) => Number(r.id) === id)
}
function breaks(api) {
  return api.listRows('firebreak')
}

// 0. 种子数据
check('种子：6 条林带', A.listRows('firebelt').length === 6)
check('种子：LB-0003 为有缺株', belt(A, 3).status === '有缺株')
check('种子：LB-0005 在批次 WH-2026-10-001', belt(A, 5)['补植批次'] === 'WH-2026-10-001')

// 1. 老林带缺种植年份，按所属林区兼容
const y3 = A.effectivePlantingYear(belt(A, 3))
check('年份兼容：南坑老林带取同林区最早年份 2009', y3.year === '2009' && y3.compatible === true, JSON.stringify(y3))
const y5 = A.effectivePlantingYear(belt(A, 5))
check('年份兼容：西坡老林带取同林区最早年份 2016', y5.year === '2016' && y5.compatible === true, JSON.stringify(y5))
const y1 = A.effectivePlantingYear(belt(A, 1))
check('年份兼容：本身有年份不兼容', y1.year === '2018' && y1.compatible === false)

// 2. 完好林带：发现缺株后只能进入补植（不能直接退化/直接验收）
let r = A.markDegraded({ ids: [1], token: tok(), reason: '', ...patrol })
check('越权：普通巡护不能归档退化', !r.ok && r.message.includes('越权'))
r = A.acceptReplant({ ids: [1], token: tok(), passed: true, comment: '', ...patrol })
check('越权：普通巡护不能验收补植', !r.ok && r.message.includes('越权'))
r = A.markDegraded({ ids: [1], token: tok(), reason: '', ...acceptor })
check('流程：完好林带不得直接归档退化', !r.ok && r.message.includes('补植环节'))
r = A.reportGaps({ ids: [1], token: tok(), detail: '测试缺株', ...patrol })
check('流程：发现缺株成功', r.ok, r.message)
check('状态：LB-0001 -> 有缺株', belt(A, 1).status === '有缺株')
r = A.reportGaps({ ids: [1], token: tok(), detail: '', ...patrol })
check('流程：只有完好林带能发现缺株', !r.ok)

// 3. 缺株后安排补植：整组一个批次
r = A.arrangeReplant({ ids: [1, 4], token: tok(), species: '木荷', ...patrol })
check('批量：两条缺株林带整组安排补植', r.ok && r.batchNo != null, r.message)
const batch1 = r.batchNo
check('状态：两条都进入需补植', belt(A, 1).status === '需补植' && belt(A, 4).status === '需补植')
check('批次：整组共用同一批次号', belt(A, 1)['补植批次'] === batch1 && belt(A, 4)['补植批次'] === batch1)
r = A.arrangeReplant({ ids: [1, 4], token: tok(), species: '木荷', ...patrol })
check('流程：需补植在途不能重复安排', !r.ok && r.message.includes('等待验收'))

// 4. 验收合格 -> 回完好 + 同步同林区隔离带台账
const before = breaks(A).find((x) => x['所属林区'] === '东岭林区')
const ledgerBefore = (before['维护台账'] || []).length
r = A.acceptReplant({ ids: [1, 4], token: tok(), passed: true, comment: '成活率92%', ...acceptor })
check('验收：合格成功并返回批次', r.ok && r.batchNo === batch1, r.message)
check('状态：两条林带回到完好', belt(A, 1).status === '完好' && belt(A, 4).status === '完好')
const after = breaks(A).find((x) => x['所属林区'] === '东岭林区')
check('联动：东岭隔离带台账新增 2 条', after['维护台账'].length === ledgerBefore + 2)
check('联动：隔离带维护状态写入批次', String(after['维护状态']).includes(batch1))
check('联动：台账结论为验收合格', after['维护台账'].every((e) => e.result === '验收合格'))
const west = breaks(A).find((x) => x['所属林区'] === '西坡林区')
check('联动：非同林区隔离带不追加', west['维护台账'].length === 0)

// 5. 树种组成冲突：保留历史 + 按年份追加
const speciesAfter = belt(A, 1)['树种组成']
check('树种：历史组成保留且补植树种按年追加',
  speciesAfter.startsWith('木荷60% 杨梅40%') && speciesAfter.includes(`${new Date().getFullYear()}补植：木荷`), speciesAfter)
check('树种函数：重复补植不重复追加',
  A.mergeSpecies(A.mergeSpecies('木荷', '木荷', '2026'), '木荷', '2026') === '木荷；2026补植：木荷')
check('树种函数：多树种顿号分隔',
  A.mergeSpecies('木荷', '杨梅、冬青', '2026') === '木荷；2026补植：杨梅；2026补植：冬青')

// 6. 重复验收只生效一次（状态守卫）
r = A.acceptReplant({ ids: [1], token: tok(), passed: true, comment: '', ...acceptor })
check('幂等：已完好不能重复验收', !r.ok && r.message.includes('重复验收'))

// 7. 两个终端对同一在途批次提交，只落一个结论
r = B.acceptReplant({ ids: [5], token: tok(), passed: true, comment: 'B终端验收', ...acceptor })
check('终端B：LB-0005 验收合格', r.ok, r.message)
A.syncFromStorage() // A 重新读盘（等价于 storage 事件回调）
r = A.acceptReplant({ ids: [5], token: tok(), passed: true, comment: 'A终端重复验收', ...acceptor })
check('终端A：读到B的结论后重复验收被拒', !r.ok && r.message.includes('不能重复验收'), r.message)
check('台账：只落一批，不重复入账',
  breaks(A).find((x) => x['所属林区'] === '西坡林区')['维护台账'].length === 1)

// 8. 同一令牌重复提交（双击/重试）只落一个结论
const sameToken = tok()
const r1 = A.reportGaps({ ids: [2], token: sameToken, detail: '第一次', ...patrol })
const r2 = A.reportGaps({ ids: [2], token: sameToken, detail: '第二次', ...patrol })
check('幂等令牌：首次生效', r1.ok)
// 同一令牌的第二次提交不允许改写结论：即便行已流转，也必须返回首次的「已处理」结果。
check('幂等令牌：同令牌重复提交返回已处理', !r2.ok && r2.message.includes('已处理过'), r2.message)
const gapTracesOf2 = belt(A, 2)['流转记录'].filter((t) => t.action === '发现缺株').length
check('幂等令牌：只有一条发现缺株流水', gapTracesOf2 === 1, `实际 ${gapTracesOf2} 条`)

// 9. 验收不合格：留需补植、不动台账；整改后再验收合格才联动
r = A.acceptReplant({ ids: [3], token: tok(), passed: false, comment: '成活率不足，退回', ...admin })
check('流程：有缺株不能直接验收', !r.ok && r.message.includes('尚未进入补植'), r.message)
r = A.arrangeReplant({ ids: [3], token: tok(), species: '杨梅', ...patrol })
check('流程：LB-0003 安排补植', r.ok, r.message)
const southLedgerBefore = breaks(A).find((x) => x['所属林区'] === '南坑林区')['维护台账'].length
r = A.acceptReplant({ ids: [3], token: tok(), passed: false, comment: '成活率不足，退回', ...admin })
check('验收：不合格返回但留在需补植', r.ok && belt(A, 3).status === '需补植')
check('验收：不合格不更新隔离带台账',
  breaks(A).find((x) => x['所属林区'] === '南坑林区')['维护台账'].length === southLedgerBefore)
r = A.acceptReplant({ ids: [3], token: tok(), passed: true, comment: '整改后合格', ...admin })
check('验收：整改后合格回完好', r.ok && belt(A, 3).status === '完好')
check('联动：南坑隔离带台账 +1',
  breaks(A).find((x) => x['所属林区'] === '南坑林区')['维护台账'].length === southLedgerBefore + 1)

// 10. 已退化终态：只能从需补植归档，且验收员/管理员
r = A.arrangeReplant({ ids: [6], token: tok(), species: '木荷', ...patrol })
check('终态：已退化不能再安排补植', !r.ok && r.message.includes('已退化'))
// LB-0002 已在第 8 步（同终端 A）报为有缺株，直接安排补植走归档退化链路。
check('前置：LB-0002 为有缺株', belt(A, 2).status === '有缺株')
r = A.arrangeReplant({ ids: [2], token: tok(), species: '木荷', ...patrol })
check('流程：LB-0002 进入需补植', r.ok, r.message)
r = A.markDegraded({ ids: [2], token: tok(), reason: '补植无恢复价值', ...patrol })
check('越权：巡护在补植环节仍不能归档退化', !r.ok && r.message.includes('越权'))
r = A.markDegraded({ ids: [2], token: tok(), reason: '补植无恢复价值', ...acceptor })
check('流程：验收员在补植环节归档退化成功', r.ok && belt(A, 2).status === '已退化')
check('终态：已退化 abnormal=true pending=false', belt(A, 2).abnormal === true && belt(A, 2).pending === false)
r = A.acceptReplant({ ids: [2], token: tok(), passed: true, comment: '', ...acceptor })
check('终态：已退化不能再验收', !r.ok)

// 11. 统计
const stats = A.firebeltStats()
check('统计：6 条林带分状态计数',
  stats.total === 6 && stats.intact === 4 && stats.degraded === 2 && stats.gaps === 0 && stats.replanting === 0,
  JSON.stringify(stats))

// 12. 整组原子性：组内一条非法则整组不落
const beforeTrace = belt(A, 6)['流转记录'].length
r = A.markDegraded({ ids: [1, 6], token: tok(), reason: '', ...admin })
check('原子：组内含完好林带时整组拒绝', !r.ok && r.message.includes('完好/缺株'), r.message)
check('原子：已退化那条流水无变化', belt(A, 6)['流转记录'].length === beforeTrace)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
