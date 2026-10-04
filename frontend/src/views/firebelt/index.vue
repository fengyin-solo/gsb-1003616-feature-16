<template>
  <section class="page" data-module="firebelt">
    <header class="page-head">
      <div>
        <h2>防火林带管理</h2>
        <p class="page-desc">
          完好 → 有缺株 → 需补植 → 验收回完好；发现缺株只能进补植，退化归档需管理员，验收需验收员或管理员。补植验收通过后自动同步隔离带维护批次与台账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记防火林带</button>
        <button class="btn" type="button" @click="exportRows">导出防火林带清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="batch-bar">
      <span>已选 {{ selectedIds.length }} 条</span>
      <select v-model="batchAction">
        <option v-for="action in actions" :key="action" :value="action">{{ action }}</option>
      </select>
      <button class="btn primary" type="button" @click="submitBatch">整组一次提交</button>
      <span class="batch-tip">整组共享一个验收批次；越权、状态不符、重复验收的条目会被逐条拒绝</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <input
              type="checkbox"
              :checked="selectedIds.includes(Number(row.id))"
              @change="toggleRow(Number(row.id))"
            />
          </td>
          <td v-for="column in columns" :key="column">
            <template v-if="column === '种植年份'">{{ plantYearText(row) }}</template>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!rowActions(row).length" class="muted-text">终态</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无防火林带数据，可先登记防火林带</td>
        </tr>
      </tbody>
    </table>

    <div v-if="speciesPrompt" class="species-panel">
      <span>为 {{ speciesPrompt.ids.length }} 条林带登记补植树种</span>
      <input v-model="speciesInput" placeholder="补植树种（留空沿用历史组成）" />
      <button class="btn primary" type="button" @click="confirmSpecies">确认安排补植</button>
      <button class="btn ghost" type="button" @click="cancelSpecies">取消</button>
      <span class="batch-tip">与历史组成不一致时保留历史组成，补植树种记入台账</span>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条防火林带记录</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  runBatchAction,
} from '@/api/local-service'
import { availableActions, resolvePlantYear } from '@/data/flows'
import { useSessionStore } from '@/stores/session'
import type { BatchResult, EntryRow } from '@/data/types'

const meta = moduleMeta('firebelt')
const columns = ["林带编号", "林带名称", "所属林区", "树种组成", "林带长度", "林带宽度", "种植年份", "补植树种", "验收批次", "林带状态"]
const actions = ["发现缺株", "安排补植", "确认补植", "标记退化"]
const statuses = ["完好", "有缺株", "需补植", "已退化"]
const stats = [{"label": "林带总数", "value": 0}, {"label": "完好条数", "value": 0}, {"label": "缺株条数", "value": 0}]

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedIds = ref<number[]>([])
const batchAction = ref('发现缺株')
const speciesPrompt = ref<{ ids: number[] } | null>(null)
const speciesInput = ref('')
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function toggleAll() {
  selectedIds.value = allChecked.value ? [] : rows.value.map((row) => Number(row.id))
}

function toggleRow(id: number) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

function rowActions(row: EntryRow): string[] {
  return availableActions(meta.key, String(row.status))
}

// 老林带缺种植年份时按所属林区补齐，并标注来源
function plantYearText(row: EntryRow): string {
  const { year, inferred } = resolvePlantYear(row, rows.value)
  if (!year) {
    return '—'
  }
  return inferred ? `${year}（按林区补齐）` : year
}

function actionContext() {
  return { operator: session.operator, role: session.role }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '防火林带登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  if (action === '安排补植') {
    speciesPrompt.value = { ids: [Number(row.id)] }
    speciesInput.value = String(row['补植树种'] ?? '') || String(row['树种组成'] ?? '')
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, actionContext())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function submitBatch() {
  errorMessage.value = ''
  successMessage.value = ''
  if (selectedIds.value.length === 0) {
    errorMessage.value = '请先勾选要提交的林带'
    return
  }
  if (batchAction.value === '安排补植') {
    speciesPrompt.value = { ids: [...selectedIds.value] }
    speciesInput.value = ''
    return
  }
  showBatchResult(runBatchAction(meta.key, selectedIds.value, batchAction.value, actionContext()))
}

function confirmSpecies() {
  if (!speciesPrompt.value) {
    return
  }
  const result = runBatchAction(meta.key, speciesPrompt.value.ids, '安排补植', {
    ...actionContext(),
    species: speciesInput.value,
  })
  speciesPrompt.value = null
  showBatchResult(result)
}

function cancelSpecies() {
  speciesPrompt.value = null
}

function showBatchResult(result: BatchResult) {
  const failed = result.items.filter((item) => !item.ok).map((item) => item.message)
  selectedIds.value = []
  reload()
  if (result.ok) {
    successMessage.value = result.message
  } else {
    errorMessage.value = [result.message, ...failed].join('；')
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '防火林带列表读取失败'
  }
}

onMounted(reload)
</script>
