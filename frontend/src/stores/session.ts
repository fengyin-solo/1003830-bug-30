import { defineStore } from 'pinia'

// 参与协作的单位清单：归属校验以「当前单位」为准，跨单位人员只能查看。
export const UNITS = ['省文物考古研究院', '市文物保护中心', '联合考古工作队'] as const

export const DEFAULT_UNIT: string = UNITS[0]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
    unit: DEFAULT_UNIT,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(label: string) {
      if (UNITS.includes(label as (typeof UNITS)[number])) {
        this.unit = label
      }
    },
  },
})
