<script setup lang="ts">
/** 数据管理卡：云端用量、手动同步、导出/导入备份、清除全部数据（含确认弹窗）、检查更新 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { parseBackupFile } from '../../stores/app/importExport'
import { BACKUP_MAX_FILE_BYTES } from '../../services/completeBackup'
import { sessionUser } from '../../services/auth'
import { syncIssue } from '../../stores/app/sync'
import { getErrorMessage } from '../../utils/error'
import { today } from '../../utils/date'
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

// 手动检查更新（仅 Windows 桌面端打包环境可用）
const updater = (window as any).updater
/** 桌面端平台标识：存在即为 Electron 桌面端（浏览器端为 undefined），用于置灰不支持自动更新的平台 */
const desktopPlatform = (window as any).desktopPlatform as string | undefined
function checkUpdate() {
  if (!updater) return
  updater.check()
  toast('正在检查更新…')
}

// ---- 数据管理 ----
const exporting = ref(false)
const backupIssue = ref('')
function downloadJson(json: string, name: string): { url: string; name: string } {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  return { url, name }
}

async function exportData() {
  if (exporting.value || importing.value || clearing.value) return
  exporting.value = true
  backupIssue.value = ''
  try {
    const file = downloadJson(await store.exportCompleteBackup(), `专升本完整备份_${today()}.json`)
    setTimeout(() => URL.revokeObjectURL(file.url), 60_000)
    toast('完整备份已导出，包含文字笔记、PDF 和错题图片')
  } catch (e) {
    console.error('导出数据失败', e)
    backupIssue.value = getErrorMessage(e, '完整备份失败，请检查网络后重试')
  } finally {
    exporting.value = false
  }
}

const importFile = ref<HTMLInputElement>()
const pendingImport = ref<{
  raw: string
  name: string
  records: number
  notes: number
  questions: number
  pdfs: number
  images: number
  complete: boolean
} | null>(null)
const importing = ref(false)
const readingImport = ref(false)
let importReadGeneration = 0
const importPhase = ref('')
const recoverySnapshot = ref<{ url: string; name: string; userId: string } | null>(null)
const availableSnapshot = computed(() =>
  recoverySnapshot.value?.userId === sessionUser.value?.id ? recoverySnapshot.value : null
)
function clearRecoverySnapshot() {
  if (recoverySnapshot.value) URL.revokeObjectURL(recoverySnapshot.value.url)
  recoverySnapshot.value = null
}
watch(
  () => sessionUser.value?.id,
  () => {
    importReadGeneration++
    readingImport.value = false
    clearRecoverySnapshot()
    pendingImport.value = null
  }
)
onBeforeUnmount(() => {
  importReadGeneration++
  clearRecoverySnapshot()
})

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 同一文件失败或取消后仍可再次选择。
  if (!file || readingImport.value || importing.value) return
  const generation = ++importReadGeneration
  readingImport.value = true
  backupIssue.value = ''
  try {
    if (file.size > BACKUP_MAX_FILE_BYTES) throw new Error('备份文件超过 192MB 上限')
    const raw = await file.text()
    const { data, complete } = await parseBackupFile(raw)
    if (generation !== importReadGeneration) return
    pendingImport.value = {
      raw,
      name: file.name,
      records: data.records.length,
      notes: data.notes.length,
      questions: data.errorQuestions.length,
      pdfs: complete?.attachments.filter((a) => a.kind === 'pdf').length ?? 0,
      images: complete?.attachments.filter((a) => a.kind === 'error-image').length ?? 0,
      complete: !!complete
    }
  } catch (e) {
    if (generation === importReadGeneration) backupIssue.value = getErrorMessage(e, '文件读取失败，请重新选择备份')
  } finally {
    if (generation === importReadGeneration) readingImport.value = false
  }
}

async function confirmImport() {
  if (!pendingImport.value || importing.value) return
  importing.value = true
  backupIssue.value = ''
  importPhase.value = '正在保存当前完整快照…'
  try {
    if (
      !(await store.restoreBackup(
        pendingImport.value.raw,
        (json) => {
          clearRecoverySnapshot()
          const file = downloadJson(json, `专升本导入前快照_${today()}_${Date.now()}.json`)
          recoverySnapshot.value = { ...file, userId: sessionUser.value!.id }
          importPhase.value = '正在恢复附件与学习数据…'
        },
        (message) => {
          importPhase.value = message
        }
      ))
    ) {
      backupIssue.value = '导入未完成，请保留导入前快照并重试'
      return
    }
    if (!(await store.saveAsync())) {
      backupIssue.value = syncIssue.value ?? '已导入本地，云端同步失败，请重试恢复；导入前快照已保留'
      return
    }
    pendingImport.value = null
    toast('备份已导入并同步')
  } catch (e) {
    backupIssue.value = getErrorMessage(e, '备份导入未完成，请保留当前快照并重试')
  } finally {
    importing.value = false
  }
}

const showClearConfirm = ref(false)
const clearText = ref('')
const clearing = ref(false)
async function clearAll() {
  if (clearText.value !== '确认清除' || clearing.value) return
  clearing.value = true
  store.clearAll()
  showClearConfirm.value = false
  toast('数据已清除')
  // 立即推送到云端，避免防抖 save() 与 location.reload() 竞态
  try {
    if (!(await store.saveAsync())) {
      toast(syncIssue.value || '本地已清除，云端尚未同步，请点击立即同步重试')
      return
    }
  } catch {
    toast('云端同步失败，请稍后重试')
    return
  } finally {
    clearing.value = false
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
      class="flex items-start gap-2 rounded-lg bg-action-soft dark:bg-action-soft px-3 py-2 text-xs text-action dark:text-action"
    >
      <TriangleAlert class="w-4 h-4 shrink-0 mt-px" />
      <span>{{ syncIssue }}</span>
    </div>
    <div class="text-xs text-slate-400">云端数据大小：{{ storageUsage }}</div>
    <div class="flex gap-2 flex-wrap">
      <button class="btn-primary" :disabled="syncing || importing || clearing || exporting" @click="syncNow">
        {{ syncing ? '同步中…' : '立即同步' }}
      </button>
      <button class="btn-ghost" :disabled="exporting || importing || clearing || syncing" @click="exportData">
        {{ exporting ? '正在收集完整备份…' : '导出完整备份' }}
      </button>
      <button
        class="btn-ghost"
        :disabled="readingImport || importing || clearing || exporting || syncing"
        @click="importFile?.click()"
      >
        {{ readingImport ? '正在读取…' : importing ? '正在导入…' : '导入数据' }}
      </button>
      <input ref="importFile" type="file" accept=".json" class="hidden" @change="onImport" />
      <button
        class="btn-danger"
        :disabled="importing || clearing || exporting"
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
      <button v-else-if="desktopPlatform" class="btn-ghost" disabled title="当前平台暂不支持自动更新">检查更新</button>
    </div>
    <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
      完整备份包含学习数据、文字笔记、PDF 原文和错题图片。云端附件需要联网读取；附件总大小上限 128MB。
      文件缺失或读取失败时会停止导出。外部资料链接仍保存为链接。
    </p>
    <p v-if="backupIssue" role="alert" class="text-sm text-correction leading-relaxed">{{ backupIssue }}</p>
    <p v-if="availableSnapshot" class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      导入前完整快照已生成并开始下载。
      <a
        :href="availableSnapshot.url"
        :download="availableSnapshot.name"
        class="text-action underline underline-offset-2"
        >再次下载当前快照</a
      >
    </p>
    <p v-if="!updater && desktopPlatform" class="mt-2 text-xs text-slate-400">
      当前平台暂不支持自动更新，请前往 GitHub Releases 手动下载新版本。
    </p>
  </div>

  <Modal title="导入备份" :show="!!pendingImport" @close="!importing && (pendingImport = null)">
    <p class="text-sm break-all">{{ pendingImport?.name }}</p>
    <p class="text-sm text-slate-500 mt-3">
      备份包含 {{ pendingImport?.records }} 条学习记录、{{ pendingImport?.notes }} 篇笔记、{{
        pendingImport?.questions
      }}
      道错题。 导入将替换当前 {{ store.records.length }} 条学习记录、{{ store.notes.length }}
      篇笔记以及其他学习数据，并同步到云端。
    </p>
    <p v-if="pendingImport?.complete" class="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
      已校验 {{ pendingImport.pdfs }} 个 PDF、{{ pendingImport.images }} 张错题图片，文件将恢复到当前账号。
    </p>
    <p v-else class="text-sm text-correction mt-2 leading-relaxed">
      这是旧版 JSON 备份，PDF 与云端错题图片仅含引用；仅在当前账号原文件仍存在时可用。
    </p>
    <p class="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
      恢复前会自动下载当前完整快照。若快照或附件准备失败，将保留当前学习数据并停止导入。
    </p>
    <p v-if="importing" role="status" class="text-sm text-slate-600 dark:text-slate-300 mt-3">{{ importPhase }}</p>
    <p v-if="backupIssue" role="alert" class="text-sm text-correction mt-3">{{ backupIssue }}</p>
    <template #footer>
      <button class="btn-ghost" :disabled="importing" @click="pendingImport = null">取消</button>
      <button class="btn-primary" :disabled="importing" @click="confirmImport">
        {{ importing ? '正在导入…' : '保存快照并导入' }}
      </button>
    </template>
  </Modal>

  <!-- 清除确认 -->
  <Modal title="危险操作" :show="showClearConfirm" @close="showClearConfirm = false">
    <p class="text-sm text-slate-500">
      此操作将永久删除所有学习记录、笔记、错题、习惯数据，<b class="text-correction">不可恢复</b>！建议先导出备份。
    </p>
    <p class="text-sm text-correction mt-3 leading-relaxed">
      上传的 PDF 与云端错题图片也会删除。请先导出完整备份；旧版仅含引用的 JSON 无法恢复这些文件。
    </p>
    <p class="text-sm mt-3">请输入「<b>确认清除</b>」以继续：</p>
    <input v-model="clearText" class="input mt-2" aria-label="确认清除" placeholder="确认清除" />
    <template #footer>
      <button class="btn-ghost" @click="showClearConfirm = false">取消</button>
      <button class="btn-danger" :disabled="clearText !== '确认清除' || clearing" @click="clearAll">
        {{ clearing ? '正在清除…' : '永久清除' }}
      </button>
    </template>
  </Modal>
</template>
