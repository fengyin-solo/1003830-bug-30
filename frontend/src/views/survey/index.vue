<template>
  <section class="page" data-module="survey">
    <header class="page-head">
      <div>
        <h2>考古调查管理</h2>
        <p class="page-desc">
          维护调查记录，围绕调查编号、调查区域、调查方法、地表发现做登记、筛选与状态流转；跨单位人员只能查看，仅原调查单位可安排复查与提交归档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记调查记录</button>
        <button class="btn" type="button" @click="exportRows">导出考古调查清单</button>
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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}<template v-if="row.archived">（已归档）</template></td>
          <td class="row-actions">
            <template v-if="rowActions(row).length">
              <button
                v-for="action in rowActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="action-hint">{{ actionHint(row) }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无考古调查数据，可先登记调查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条考古调查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  allowedActions,
  canOperateRow,
  downloadEntries,
  isRowArchived,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('survey')
const store = useSessionStore()
const columns = ["调查编号", "调查区域", "调查方法", "地表发现", "断面观察", "初步断代", "调查人", "调查单位", "记录状态"]
const statuses = ["调查中", "已记录", "已复核", "需复查"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = computed(() => [
  { label: '调查次数', value: total.value },
  { label: '已复核记录', value: rows.value.filter((row) => String(row.status) === '已复核').length },
  { label: '待复查记录', value: rows.value.filter((row) => String(row.status) === '需复查').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function rowActions(row: EntryRow): string[] {
  return allowedActions(meta, row, store.unit, rows.value)
}

function actionHint(row: EntryRow): string {
  if (isRowArchived(row)) {
    return '已归档，仅可查看'
  }
  if (!canOperateRow(meta, row, store.unit)) {
    return '跨单位仅可查看'
  }
  return '暂无可用动作'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '调查记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.unit)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '考古调查列表读取失败'
  }
}

onMounted(reload)
</script>
