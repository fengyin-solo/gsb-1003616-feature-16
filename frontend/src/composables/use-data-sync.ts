import { onBeforeUnmount, onMounted } from 'vue'

import { DATA_CHANGED_EVENT, syncFromStorage } from '@/data/local-store'

// 两个终端 / 其他页面写入后，当前页面自动跟着刷新：
// - 同标签页内别的模块提交：监听自定义事件
// - 另一个标签页提交：监听 window storage 事件，先把本页缓存与磁盘对齐再回调
export function useDataSync(onChange: (keys: string[]) => void) {
  function handleLocal(event: Event) {
    const detail = (event as CustomEvent<{ keys?: string[] }>).detail
    onChange(detail?.keys ?? [])
  }

  function handleStorage(event: StorageEvent) {
    if (!event.key || event.key.startsWith('forest-fire-patrol:idempotency')) {
      return
    }
    const keys = syncFromStorage()
    onChange(keys)
  }

  onMounted(() => {
    window.addEventListener(DATA_CHANGED_EVENT, handleLocal as EventListener)
    window.addEventListener('storage', handleStorage)
  })

  onBeforeUnmount(() => {
    window.removeEventListener(DATA_CHANGED_EVENT, handleLocal as EventListener)
    window.removeEventListener('storage', handleStorage)
  })
}
