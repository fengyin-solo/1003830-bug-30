<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">田野考古发掘数字化管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向考古发掘现场探方管理、地层记录、遗迹测绘、遗物登记、浮选采样与测年送检全流程的田野考古数字化管理平台。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.shiftLabel }}
          <label class="unit-switch">
            当前单位
            <select :value="store.unit" @change="onUnitChange">
              <option v-for="unit in units" :key="unit" :value="unit">{{ unit }}</option>
            </select>
          </label>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { SURVEY_UNITS } from '@/data/ownership'

const store = useSessionStore()

const units = [...SURVEY_UNITS]

function onUnitChange(event: Event) {
  store.setUnit((event.target as HTMLSelectElement).value)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "探方管理", path: "/trench" }, { label: "地层记录", path: "/stratum" }, { label: "遗迹单位", path: "/feature" }, { label: "出土遗物", path: "/artifact" }, { label: "浮选采样", path: "/flotation" }, { label: "测年送检", path: "/dating" }, { label: "影像记录", path: "/photography" }, { label: "实测绘图", path: "/drawing" }, { label: "发掘日记", path: "/diary" }, { label: "考古调查", path: "/survey" }, { label: "人骨鉴定", path: "/human_bone" }, { label: "动物骨骼", path: "/animal_bone" }, { label: "陶器整理", path: "/pottery" }, { label: "现场保护", path: "/conservation" }, { label: "三维坐标", path: "/coordinate" }, { label: "库房管理", path: "/storage" }, { label: "耗材管理", path: "/material" }, { label: "工地接待", path: "/visit" }]
</script>

<style scoped>
.unit-switch { display: inline-flex; align-items: center; gap: 4px; margin-left: 12px; }
.unit-switch select { padding: 2px 4px; }
</style>

