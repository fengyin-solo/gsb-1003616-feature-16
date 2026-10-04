import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    // 角色决定能不能验收补植、归档退化：巡护员只能发现缺株和安排补植
    role: '管理员',
    roles: ['巡护员', '验收员', '管理员'],
    shiftLabel: '白班 08:00-20:00',
    scope: '森林防火巡护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: string) {
      this.role = role
    },
  },
})
