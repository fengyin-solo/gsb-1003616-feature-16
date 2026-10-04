import { defineStore } from 'pinia'

import type { RoleKey, RoleOption } from '@/data/types'

// 与状态机配套的角色：越权动作（普通巡护验收/归档退化）直接拒绝。
export const ROLE_OPTIONS: RoleOption[] = [
  { key: 'patrol', label: '普通巡护员' },
  { key: 'acceptance', label: '补植验收员' },
  { key: 'admin', label: '防火管理员' },
]

export function roleLabel(key: string): string {
  return ROLE_OPTIONS.find((item) => item.key === key)?.label ?? key
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '森林防火巡护管理系统',
    role: 'admin' as RoleKey,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 验收补植、归档退化属于收敛动作，普通巡护无权执行。
    canAccept: (state) => state.role === 'acceptance' || state.role === 'admin',
    isPatrol: (state) => state.role === 'patrol',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: RoleKey) {
      this.role = role
    },
  },
})
