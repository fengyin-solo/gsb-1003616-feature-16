<template>
  <section class="page" data-module="firebreak">
    <header class="page-head">
      <div>
        <h2>防火隔离带管理</h2>
        <p class="page-desc">维护防火隔离带；林带补植验收合格后，同林区隔离带自动追加维护批次与台账记录。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出防火隔离带清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">隔离带条数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">正常</span>
        <strong class="stat-value">{{ countOf('正常') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">需维护</span>
        <strong class="stat-value">{{ countOf('需割草') + countOf('需补植') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已荒废</span>
        <strong class="stat-value">{{ countOf('已荒废') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计补植维护批次</span>
        <strong class="stat-value">{{ ledgerCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>隔离带编号</span>
        <input v-model="filters['隔离带编号']" placeholder="按隔离带编号检索" />
      </label>
      <label class="filter-item">
        <span>所属林区</span>
        <input v-model="filters['所属林区']" placeholder="按所属林区检索" />
      </label>
      <label class="filter-item">
        <span>补植批次</span>
        <input v-model="filters['补植批次']" placeholder="按补植批次检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>台账</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td>{{ row['隔离带编号'] ?? '—' }}</td>
            <td>{{ row['所属林区'] ?? '—' }}</td>
            <td>{{ row['起止坐标'] ?? '—' }}</td>
            <td>{{ row['带宽米数'] ?? '—' }}</td>
            <td>{{ row['建成日期'] ?? '—' }}</td>
            <td>{{ row['最近维护日期'] ?? '—' }}</td>
            <td>{{ row['植被恢复程度'] ?? '—' }}</td>
            <td>
              <span v-if="row['补植批次']" class="batch-tag">{{ row['补植批次'] }}</span>
              <span v-else>—</span>
            </td>
            <td>{{ row['维护状态'] ?? '—' }}</td>
            <td>
              <span :class="['status-pill', statusClass(row.status)]">{{ row.status }}</span>
            </td>
            <td>
              <button class="link" type="button" @click="toggleLedger(row.id)">
                {{ ledgerOpenId === row.id ? '收起台账' : `维护台账（${ledgerOf(row).length}）` }}
              </button>
            </td>
          </tr>
          <tr v-if="ledgerOpenId === row.id" class="trace-row">
            <td :colspan="columns.length + 2">
              <table v-if="ledgerOf(row).length" class="ledger-table">
                <thead>
                  <tr>
                    <th>入账时间</th>
                    <th>补植批次</th>
                    <th>来源林带</th>
                    <th>补植树种</th>
                    <th>结论</th>
                    <th>验收人</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(entry, index) in ledgerOf(row)" :key="index">
                    <td>{{ entry.time }}</td>
                    <td>{{ entry.batchNo }}</td>
                    <td>{{ entry.beltNo }}</td>
                    <td>{{ entry.species }}</td>
                    <td>{{ entry.result }}</td>
                    <td>{{ entry.acceptor }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="empty-state">暂无维护台账；同林区林带补植验收合格后自动入账</p>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无防火隔离带数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条防火隔离带记录；台账由防火林带补植验收结论同步，重复验收不会重复入账</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries, filterRows, listEntries, moduleMeta } from '@/api/local-service'
import { useDataSync } from '@/composables/use-data-sync'
import type { EntryRow, FirebreakLedgerEntry } from '@/data/types'

const meta = moduleMeta('firebreak')
const columns = ["隔离带编号", "所属林区", "起止坐标", "带宽米数", "建成日期", "最近维护日期", "植被恢复程度", "补植批次", "维护状态"]
const statuses = ["正常", "需割草", "需补植", "已荒废"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const ledgerOpenId = ref<number | null>(null)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const ledgerCount = computed(() =>
  rows.value.reduce((sum, row) => sum + ledgerOf(row).length, 0),
)

function ledgerOf(row: EntryRow): FirebreakLedgerEntry[] {
  const value = row['维护台账']
  return Array.isArray(value) ? (value as FirebreakLedgerEntry[]) : []
}

function countOf(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function statusClass(status: string): string {
  return {
    正常: 'st-ok',
    需割草: 'st-wait',
    需补植: 'st-gap',
    已荒废: 'st-dead',
  }[status] ?? ''
}

function toggleLedger(id: number) {
  ledgerOpenId.value = ledgerOpenId.value === id ? null : id
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  const matched = filterRows(listEntries(meta.key).items, filters.value)
  rows.value = matched
  total.value = matched.length
}

// 林带页面验收后，本页台账跟着更新；别的终端提交也一样。
useDataSync((keys) => {
  if (keys.includes(meta.key)) {
    reload()
  }
})

reload()
</script>
