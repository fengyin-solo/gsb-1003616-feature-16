<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <div class="dashboard-ledger">
      <h3>防火隔离带维护台账（随防火林带补植验收结果实时更新）</h3>
      <table v-if="ledgerEntries.length" class="data-table">
        <thead>
          <tr>
            <th>入账时间</th>
            <th>补植批次</th>
            <th>所属林区</th>
            <th>隔离带</th>
            <th>来源林带</th>
            <th>补植树种</th>
            <th>结论</th>
            <th>验收人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in ledgerEntries" :key="index">
            <td>{{ item.entry.time }}</td>
            <td>{{ item.entry.batchNo }}</td>
            <td>{{ item.entry.region }}</td>
            <td>{{ item.breakNo }}</td>
            <td>{{ item.entry.beltNo }}</td>
            <td>{{ item.entry.species }}</td>
            <td><span class="status-pill st-ok">{{ item.entry.result }}</span></td>
            <td>{{ item.entry.acceptor }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">暂无补植维护入账；林带补植验收合格后，这里会与隔离带页面同步出现批次记录</p>
    </div>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；多标签页打开时结论实时同步</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useDataSync } from '@/composables/use-data-sync'
import { listRows } from '@/data/local-store'
import type { EntryRow, FirebreakLedgerEntry, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const breaks = ref<EntryRow[]>([])

const ledgerEntries = computed(() => {
  const flattened: { entry: FirebreakLedgerEntry; breakNo: string }[] = []
  for (const row of breaks.value) {
    const value = row['维护台账']
    if (Array.isArray(value)) {
      for (const entry of value as FirebreakLedgerEntry[]) {
        flattened.push({ entry, breakNo: String(row['隔离带编号'] ?? '') })
      }
    }
  }
  return flattened.sort((a, b) => (a.entry.time < b.entry.time ? 1 : -1))
})

function loadLedger() {
  breaks.value = listRows('firebreak')
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  loadLedger()
}

// 其他页面提交补植验收后，概览页台账跟着更新（含另一个终端的提交）。
useDataSync((keys) => {
  if (keys.includes('firebreak') || keys.includes('firebelt')) {
    loadLedger()
  }
})

onMounted(refresh)
</script>
