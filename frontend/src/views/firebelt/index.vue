<template>
  <section class="page" data-module="firebelt">
    <header class="page-head">
      <div>
        <h2>防火林带管理</h2>
        <p class="page-desc">
          林带状态按「完好 → 有缺株 → 需补植 → 验收合格回完好」可追踪流转；已退化只能在补植环节由验收员/管理员归档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出防火林带清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">林带总数</span>
        <strong class="stat-value">{{ stats.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">完好条数</span>
        <strong class="stat-value">{{ stats.intact }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">有缺株</span>
        <strong class="stat-value">{{ stats.gaps }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">需补植（在批次中）</span>
        <strong class="stat-value">{{ stats.replanting }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已退化</span>
        <strong class="stat-value">{{ stats.degraded }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item role-hint">当前角色：{{ roleText }}（{{ store.operator }}）</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>林带编号</span>
        <input v-model="filters['林带编号']" placeholder="按林带编号检索" />
      </label>
      <label class="filter-item">
        <span>林带名称</span>
        <input v-model="filters['林带名称']" placeholder="按林带名称检索" />
      </label>
      <label class="filter-item">
        <span>所属林区</span>
        <input v-model="filters['所属林区']" placeholder="按所属林区检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 批量多选后整组一次提交 -->
    <div class="batch-bar">
      <span class="batch-tip">已选 {{ selectedIds.length }} 条（整组一次提交）：</span>
      <button class="btn" type="button" :disabled="!selectedIds.length" @click="openGapBatch">
        发现缺株
      </button>
      <button class="btn" type="button" :disabled="!selectedIds.length" @click="openArrangeBatch">
        安排补植
      </button>
      <button
        class="btn"
        type="button"
        :disabled="!selectedIds.length || !store.canAccept"
        :title="store.canAccept ? '' : '普通巡护员无权验收补植'"
        @click="openAcceptBatch"
      >
        验收补植
      </button>
      <button
        class="btn danger"
        type="button"
        :disabled="!selectedIds.length || !store.canAccept"
        :title="store.canAccept ? '' : '退化不得由普通巡护直接归档'"
        @click="openDegradeBatch"
      >
        标记退化
      </button>
      <button class="btn ghost" type="button" :disabled="!selectedIds.length" @click="clearSelection">
        清空选择
      </button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-col">
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              :indeterminate.prop="someVisibleSelected && !allVisibleSelected"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
          <th>流程</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td class="check-col">
              <input type="checkbox" :checked="isSelected(row.id)" @change="toggleOne(row.id)" />
            </td>
            <td>{{ row['林带编号'] ?? '—' }}</td>
            <td>{{ row['林带名称'] ?? '—' }}</td>
            <td>{{ row['所属林区'] ?? '—' }}</td>
            <td>{{ row['树种组成'] ?? '—' }}</td>
            <td>{{ row['林带长度'] ?? '—' }}</td>
            <td>{{ row['林带宽度'] ?? '—' }}</td>
            <td>
              {{ yearOf(row).year }}
              <em v-if="yearOf(row).compatible" class="compat-tag" title="老林带缺种植年份，按所属林区兼容取值">兼容</em>
            </td>
            <td>
              {{ row['补植批次'] || '—' }}
              <span v-if="row['补植树种']" class="muted-text">（{{ row['补植树种'] }}）</span>
            </td>
            <td>{{ row['林带状态'] ?? '—' }}</td>
            <td>
              <span :class="['status-pill', statusClass(row.status)]">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="String(row.status) === '完好'"
                class="link"
                type="button"
                @click="openGapSingle(row)"
              >
                发现缺株
              </button>
              <button
                v-if="String(row.status) === '有缺株'"
                class="link"
                type="button"
                @click="openArrangeSingle(row)"
              >
                安排补植
              </button>
              <template v-if="String(row.status) === '需补植'">
                <button
                  class="link"
                  type="button"
                  :class="{ 'link-disabled': !store.canAccept }"
                  :title="store.canAccept ? '' : '越权：普通巡护员不能验收补植'"
                  @click="store.canAccept && openAcceptSingle(row)"
                >
                  验收补植
                </button>
                <button
                  class="link link-danger"
                  type="button"
                  :class="{ 'link-disabled': !store.canAccept }"
                  :title="store.canAccept ? '' : '越权：退化不得由普通巡护直接归档'"
                  @click="store.canAccept && openDegradeSingle(row)"
                >
                  标记退化
                </button>
              </template>
              <span v-if="String(row.status) === '已退化'" class="muted-text">终态</span>
            </td>
            <td>
              <button class="link" type="button" @click="toggleTrace(row.id)">
                {{ traceOpenId === row.id ? '收起' : '追踪' }}
              </button>
            </td>
          </tr>
          <tr v-if="traceOpenId === row.id" class="trace-row">
            <td :colspan="columns.length + 4">
              <ol class="trace-list">
                <li v-for="(trace, index) in tracesOf(row)" :key="index">
                  <span class="trace-time">{{ trace.time }}</span>
                  <span class="trace-action">{{ trace.action }}</span>
                  <span class="trace-operator">{{ trace.operator }}（{{ trace.role }}）</span>
                  <span v-if="trace.detail" class="trace-detail">{{ trace.detail }}</span>
                </li>
              </ol>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无防火林带数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条防火林带记录；补植验收合格后自动同步同林区防火隔离带维护台账</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 发现缺株 -->
    <div v-if="dialog.kind === 'gap'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>发现缺株（{{ dialog.ids.length }} 条）</h3>
        <p class="modal-hint">上报后林带进入「有缺株」，后续只能安排补植，不能跳过。</p>
        <label class="modal-field">
          <span>缺株情况说明</span>
          <textarea v-model="dialog.detail" rows="3" placeholder="如：K22+500 段缺株约120株"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitGap">整组提交</button>
        </div>
      </div>
    </div>

    <!-- 安排补植 -->
    <div v-if="dialog.kind === 'arrange'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>安排补植（{{ dialog.ids.length }} 条）</h3>
        <p class="modal-hint">整组共用一个维护批次；补植树种与历史组成冲突时，历史组成保留、补植树种按年份追加。</p>
        <label class="modal-field">
          <span>补植树种</span>
          <input v-model="dialog.species" placeholder="如：木荷（多个树种用顿号分隔）" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitArrange">整组提交</button>
        </div>
      </div>
    </div>

    <!-- 验收补植 -->
    <div v-if="dialog.kind === 'accept'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>验收补植（{{ dialog.ids.length }} 条，批次 {{ acceptBatchLabel }}）</h3>
        <p class="modal-hint">只能验收同一批次；合格才回到「完好」并同步防火隔离带维护台账，重复验收只生效一次。</p>
        <label class="modal-field">
          <span>验收结论</span>
          <span class="radio-line">
            <label><input v-model="dialog.passed" type="radio" :value="true" /> 验收合格</label>
            <label><input v-model="dialog.passed" type="radio" :value="false" /> 验收不合格（退回整改）</label>
          </span>
        </label>
        <label class="modal-field">
          <span>验收意见</span>
          <textarea v-model="dialog.comment" rows="3" placeholder="成活率、整改要求等"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitAccept">提交验收结论</button>
        </div>
      </div>
    </div>

    <!-- 标记退化 -->
    <div v-if="dialog.kind === 'degrade'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>归档已退化（{{ dialog.ids.length }} 条）</h3>
        <p class="modal-hint">退化归档只在补植环节开放，普通巡护无权办理；归档后为终态，纳入重建计划。</p>
        <label class="modal-field">
          <span>退化原因</span>
          <textarea v-model="dialog.reason" rows="3" placeholder="如：补植后成活率不足30%，无恢复价值"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn danger" type="button" :disabled="submitting" @click="submitDegrade">确认归档</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  acceptReplant,
  arrangeReplant,
  effectivePlantingYear,
  firebeltStats,
  markDegraded,
  reportGaps,
} from '@/api/firebelt-service'
import { downloadEntries, filterRows, listEntries, moduleMeta } from '@/api/local-service'
import { useDataSync } from '@/composables/use-data-sync'
import type { EntryRow, FlowTraceEntry, RoleKey } from '@/data/types'
import { roleLabel, useSessionStore } from '@/stores/session'

const meta = moduleMeta('firebelt')
const store = useSessionStore()
const columns = ["林带编号", "林带名称", "所属林区", "树种组成", "林带长度", "林带宽度", "种植年份", "补植批次", "林带状态"]
const statuses = ["完好", "有缺株", "需补植", "已退化"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const selectedIds = ref<number[]>([])
const traceOpenId = ref<number | null>(null)
const message = ref('')
const messageOk = ref(false)
const submitting = ref(false)

type DialogKind = '' | 'gap' | 'arrange' | 'accept' | 'degrade'
const dialog = reactive<{
  kind: DialogKind
  ids: number[]
  detail: string
  species: string
  passed: boolean
  comment: string
  reason: string
  token: string
}>({
  kind: '',
  ids: [],
  detail: '',
  species: '',
  passed: true,
  comment: '',
  reason: '',
  token: '',
})

const stats = computed(() => firebeltStats())
const roleText = computed(() => roleLabel(store.role as RoleKey))

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const visibleIds = computed(() => rows.value.map((row) => Number(row.id)))
const allVisibleSelected = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.includes(id)),
)
const someVisibleSelected = computed(() => visibleIds.value.some((id) => selectedIds.value.includes(id)))

const acceptBatchLabel = computed(() => {
  const values = new Set(
    dialog.ids
      .map((id) => rows.value.find((row) => Number(row.id) === id))
      .filter(Boolean)
      .map((row) => String(row!['补植批次'] || '')),
  )
  return values.size === 1 ? [...values][0] : '混批不可提交'
})

function tracesOf(row: EntryRow): FlowTraceEntry[] {
  const value = row['流转记录']
  return Array.isArray(value) ? (value as FlowTraceEntry[]) : []
}

function yearOf(row: EntryRow) {
  return effectivePlantingYear(row, rows.value)
}

function statusClass(status: string): string {
  return {
    完好: 'st-ok',
    有缺株: 'st-gap',
    需补植: 'st-wait',
    已退化: 'st-dead',
  }[status] ?? ''
}

function isSelected(id: number): boolean {
  return selectedIds.value.includes(id)
}

function toggleOne(id: number) {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    const merged = new Set([...selectedIds.value, ...visibleIds.value])
    selectedIds.value = [...merged]
  } else {
    const visible = new Set(visibleIds.value)
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id))
  }
}

function clearSelection() {
  selectedIds.value = []
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  message.value = ''
  const matched = filterRows(listEntries(meta.key).items, filters.value)
  rows.value = matched
  total.value = matched.length
  // 过滤后丢弃已不可见的选择，避免整组提交混进屏幕外记录。
  const visible = new Set(matched.map((row) => Number(row.id)))
  selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
}

function toggleTrace(id: number) {
  traceOpenId.value = traceOpenId.value === id ? null : id
}

function newToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `tok-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function openDialog(kind: Exclude<DialogKind, ''>, ids: number[]) {
  Object.assign(dialog, {
    kind,
    ids,
    detail: '',
    species: '',
    passed: true,
    comment: '',
    reason: '',
    token: newToken(),
  })
}

function closeDialog() {
  dialog.kind = ''
}

function openGapBatch() {
  openDialog('gap', [...selectedIds.value])
}
function openArrangeBatch() {
  openDialog('arrange', [...selectedIds.value])
}
function openAcceptBatch() {
  openDialog('accept', [...selectedIds.value])
}
function openDegradeBatch() {
  openDialog('degrade', [...selectedIds.value])
}
function openGapSingle(row: EntryRow) {
  openDialog('gap', [Number(row.id)])
}
function openArrangeSingle(row: EntryRow) {
  openDialog('arrange', [Number(row.id)])
  dialog.species = String(row['补植树种'] ?? '')
}
function openAcceptSingle(row: EntryRow) {
  openDialog('accept', [Number(row.id)])
}
function openDegradeSingle(row: EntryRow) {
  openDialog('degrade', [Number(row.id)])
}

function baseSubmit() {
  return {
    ids: dialog.ids,
    operator: store.operator,
    role: store.role as RoleKey,
    token: dialog.token,
  }
}

function afterSubmit(ok: boolean, text: string) {
  submitting.value = false
  notify(ok, text)
  if (ok) {
    closeDialog()
  }
  reload()
}

function submitGap() {
  submitting.value = true
  const result = reportGaps({ ...baseSubmit(), detail: dialog.detail })
  afterSubmit(result.ok, result.message)
}

function submitArrange() {
  submitting.value = true
  const result = arrangeReplant({ ...baseSubmit(), species: dialog.species })
  afterSubmit(result.ok, result.message)
}

function submitAccept() {
  submitting.value = true
  const result = acceptReplant({
    ...baseSubmit(),
    passed: dialog.passed,
    comment: dialog.comment,
  })
  afterSubmit(result.ok, result.message)
}

function submitDegrade() {
  submitting.value = true
  const result = markDegraded({ ...baseSubmit(), reason: dialog.reason })
  afterSubmit(result.ok, result.message)
}

// 另一个终端或隔离带页面提交后，本页跟着刷新结论。
useDataSync((keys) => {
  if (keys.includes(meta.key) || keys.includes('firebreak')) {
    reload()
  }
})

reload()
</script>
