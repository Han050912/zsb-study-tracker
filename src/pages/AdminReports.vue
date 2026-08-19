<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import { fromNow } from '../utils/date'
import type { AdminReport } from '../types'

/**
 * 管理员后台（首个模块：举报处理队列）。
 * 处理动作：隐藏 / 删除 / 驳回，均可选填处理说明；处理结果由服务端通知当事人并留痕。
 */
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const reports = ref<AdminReport[]>([])
const loading = ref(true)
/** 正在确认处理的举报：记录动作与说明 */
const confirming = ref<{ id: string; action: 'hide' | 'delete' | 'reject' } | null>(null)
const note = ref('')
const submitting = ref(false)

onMounted(load)

async function load() {
  loading.value = true
  try {
    const res = await communityApi.adminReports()
    reports.value = res.reports
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function ask(id: string, action: 'hide' | 'delete' | 'reject') {
  confirming.value = { id, action }
  note.value = ''
}

const ACTION_TEXT = { hide: '隐藏', delete: '删除', reject: '驳回' } as const

/** 举报目标类型文案（私信举报无跳转目标，仅会话双方可见） */
const TYPE_TEXT: Record<AdminReport['targetType'], string> = { post: '帖子', comment: '评论', message: '私信' }

async function confirmResolve() {
  if (!confirming.value || submitting.value) return
  submitting.value = true
  try {
    await communityApi.adminResolveReport(confirming.value.id, confirming.value.action, note.value.trim() || undefined)
    reports.value = reports.value.filter(r => r.id !== confirming.value!.id)
    toast('已处理并通知当事人')
    confirming.value = null
  } catch (e: any) {
    toast(e?.message || '处理失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2.5" @click="router.back()">←</button>
      <h1 class="page-title">🛡️ 审核中心</h1>
      <span v-if="reports.length" class="text-xs px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-500">
        {{ reports.length }} 条待处理
      </span>
    </div>

    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="!reports.length" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2">✨</div>
      <p>暂无待处理举报，社区一片祥和</p>
    </div>

    <div v-else class="space-y-3">
      <div v-for="r in reports" :key="r.id" class="card space-y-2">
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <span class="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-900/30 text-orange-500 font-medium">{{ r.reason }}</span>
          <span>{{ TYPE_TEXT[r.targetType] }}</span>
          <span>{{ r.reporterName }} 举报</span>
          <span class="ml-auto">{{ fromNow(r.createdAt) }}</span>
        </div>

        <div v-if="r.target" class="rounded-lg bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
          <div class="text-[10px] text-slate-400 mb-0.5">
            {{ r.target.authorName }} 的{{ TYPE_TEXT[r.targetType] }}
            <span v-if="r.target.isHidden" class="text-red-400 ml-1">（已隐藏）</span>
          </div>
          <p class="text-sm whitespace-pre-wrap break-words">{{ r.target.excerpt }}</p>
          <button v-if="r.target.postId" class="text-[10px] text-primary-500 mt-1" @click="router.push(`/community/post/${r.target.postId}`)">
            查看原帖 →
          </button>
          <div v-else-if="r.targetType === 'message'" class="text-[10px] text-slate-400 mt-1">
            私信仅会话双方可见，可按内容预览与举报说明判断
          </div>
        </div>
        <div v-else class="text-xs text-slate-400 px-1">目标内容已被作者删除</div>

        <p v-if="r.detail" class="text-xs text-slate-500 dark:text-slate-400">补充说明：{{ r.detail }}</p>

        <!-- 处理操作 -->
        <div v-if="confirming?.id !== r.id" class="flex gap-2 pt-1">
          <template v-if="r.target">
            <!-- 私信不支持隐藏（仅会话双方可见），服务端会拒绝；只提供删除/驳回 -->
            <button v-if="r.targetType !== 'message'" class="btn-ghost !text-xs" @click="ask(r.id, 'hide')">🙈 隐藏</button>
            <button class="btn-ghost !text-xs !text-red-500" @click="ask(r.id, 'delete')">🗑️ 删除</button>
          </template>
          <button v-else class="btn-ghost !text-xs" @click="ask(r.id, 'delete')">✅ 结案</button>
          <button class="btn-ghost !text-xs ml-auto" @click="ask(r.id, 'reject')">驳回举报</button>
        </div>
        <div v-else class="space-y-2 pt-1">
          <input v-model="note" maxlength="200" class="input !py-1.5 text-xs"
            :placeholder="`处理说明（可选，将随通知发给当事人）`" />
          <div class="flex gap-2 justify-end">
            <button class="btn-ghost !text-xs" @click="confirming = null">取消</button>
            <button class="btn-primary !text-xs" :disabled="submitting" @click="confirmResolve">
              确认{{ confirming.action === 'delete' && !r.target ? '结案' : ACTION_TEXT[confirming.action] }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
