<script setup lang="ts">
/** 数据管理卡：云端用量、手动同步、导出/导入备份、清除全部数据（含确认弹窗）、检查更新 */
import { onMounted, ref } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { parseBackup } from '../../stores/app/importExport'
import { syncIssue } from '../../stores/app/sync'
import Modal from '../Modal.vue'

const store = useAppStore()
const toast = useToast()

const storageUsage = ref('—')
onMounted(async () => {
  try {
    storageUsage.value = await store.storageUsageText()
  } catch {
    /* 忽略 */
  }
})

// 手动检查更新（仅桌面端打包环境可用）
const updater = (window as any).updater
function checkUpdate() {
  if (!updater) return
  updater.check()
  toast('正在检查更新…')
}

// ---- 数据管理 ----
async function exportData() {
  try {
    const blob = new Blob([await store.exportJSON()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `专升本学习数据_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 延迟释放：点击后同步 revoke 会中断下载
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast('数据已导出')
  } catch (e) {
    console.error('导出数据失败', e)
    toast('导出失败，请重试')
  }
}

const importFile = ref<HTMLInputElement>()
async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    const raw = reader.result as string
    // 先校验备份结构再走成功分支：导入是「先删后写入」，错误文件一旦进流程会清空本地与云端数据
    if (!parseBackup(raw)) {
      toast('导入失败：文件格式不正确')
      return
    }
    if (!store.importJSON(raw)) {
      toast('导入失败：请稍后重试')
      return
    }
    toast('导入成功！')
    // 立即推送到云端，避免防抖 save() 与 location.reload() 竞态导致数据丢失
    if (!(await store.saveAsync())) toast(syncIssue.value ?? '云端同步失败，变更将在下次同步时重试')
    setTimeout(() => location.reload(), 300)
  }
  reader.readAsText(file)
}

const showClearConfirm = ref(false)
const clearText = ref('')
async function clearAll() {
  if (clearText.value !== '确认清除') return
  store.clearAll()
  showClearConfirm.value = false
  toast('数据已清除')
  // 立即推送到云端，避免防抖 save() 与 location.reload() 竞态
  try {
    await store.saveAsync()
  } catch {
    toast('云端同步失败，请稍后重试')
  }
  setTimeout(() => location.reload(), 300)
}

// ---- 立即同步（手动触发：先推送本地待同步变更，再增量拉取服务端变更）----
const syncing = ref(false)
async function syncNow() {
  if (syncing.value) return
  syncing.value = true
  try {
    const r = await store.syncNow()
    // 4xx 是服务端明确拒绝（毒记录），原因已由 store 写入 syncIssue：直接展示，别误导成网络问题
    if (!r.ok) toast(syncIssue.value ?? '同步失败，请检查网络后重试')
    else if (r.rejected > 0)
      toast(`同步完成：上传 ${r.applied} 条，${r.rejected} 条被服务端拒绝（本地保留，待下次拉取覆盖）`)
    else toast(`同步完成：上传 ${r.applied} 条，拉取 ${r.changed} 条`)
  } catch {
    toast('同步失败，请检查网络后重试')
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <!-- 数据管理 -->
  <div class="card space-y-3">
    <div class="section-title">数据管理</div>
    <!-- 推送失败（尤其 4xx 毒记录）会让云同步长期静默停止，必须常驻可见，直到下一次推送成功 -->
    <div
      v-if="syncIssue"
      class="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
    >
      <TriangleAlert class="w-4 h-4 shrink-0 mt-px" />
      <span>{{ syncIssue }}</span>
    </div>
    <div class="text-xs text-slate-400">云端数据大小：{{ storageUsage }}</div>
    <div class="flex gap-2 flex-wrap">
      <button class="btn-primary" :disabled="syncing" @click="syncNow">
        {{ syncing ? '同步中…' : '立即同步' }}
      </button>
      <button class="btn-ghost" @click="exportData">导出 JSON 备份</button>
      <button class="btn-ghost" @click="importFile?.click()">导入数据</button>
      <input ref="importFile" type="file" accept=".json" class="hidden" @change="onImport" />
      <button
        class="btn-danger"
        @click="
          () => {
            showClearConfirm = true
            clearText = ''
          }
        "
      >
        清除全部数据
      </button>
      <button v-if="updater" class="btn-ghost" @click="checkUpdate">检查更新</button>
    </div>
  </div>

  <!-- 清除确认 -->
  <Modal title="危险操作" :show="showClearConfirm" @close="showClearConfirm = false">
    <p class="text-sm text-slate-500">
      此操作将永久删除所有学习记录、笔记、错题、习惯数据，<b class="text-red-500">不可恢复</b>！建议先导出备份。
    </p>
    <p class="text-sm mt-3">请输入「<b>确认清除</b>」以继续：</p>
    <input v-model="clearText" class="input mt-2" placeholder="确认清除" />
    <template #footer>
      <button class="btn-ghost" @click="showClearConfirm = false">取消</button>
      <button class="btn-danger" :disabled="clearText !== '确认清除'" @click="clearAll">永久清除</button>
    </template>
  </Modal>
</template>
