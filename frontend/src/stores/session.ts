import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    // 当前操作人员所属单位；调查记录的复查、归档等写动作只认这条归属。
    unit: '省考古研究院调查一队',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      this.unit = unit
    },
  },
})
