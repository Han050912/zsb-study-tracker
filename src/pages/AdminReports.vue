<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi, imageUrl } from '../api/community'
import { feedbackApi } from '../api/feedback'
import { fromNow } from '../utils/date'
import { useBack } from '../composables/useBack'
import type { AdminReport, Feedback, FeedbackStatus, HotTopicOverride } from '../types'

/**
 * 管理员后台（首个模块：举报处理队列）。
 * 处理动作：隐藏 / 删除 / 驳回，均可选填处理说明；处理结果由服务端通知当事人并留痕。
 */
const router = useRouter()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})

const reports = ref<AdminReport[]>([])
const loading = ref(true)
/** 正在确认处理的举报：记录动作与说明 */
const confirming = ref<{ id: string; action: 'hide' | 'delete' | 'reject' } | null>(null)
const note = ref('')
const submitting = ref(false)

// ---- Tab 切换（举报 / 反馈 / 热门话题） ----
const activeTab = ref<'reports' | 'feedback' | 'topics'>('reports')

// ---- 意见反馈管理 ----
const FB_TYPE_LABEL: Record<Feedback['type'], string> = {
  feature: '功能建议', bug: 'Bug报告', experience: '体验评价', other: '其他'
}
const feedbacks = ref<Feedback[]>([])
const feedbackLoading = ref(false)
const feedbackFilter = ref<'all' | FeedbackStatus>('all')

async function loadFeedback() {
  feedbackLoading.value = true
  try {
    const res = await feedbackApi.adminList(feedbackFilter.value === 'all' ? undefined : feedbackFilter.value)
    feedbacks.value = res.feedbacks
  } catch (e: any) {
    toast(e?.message || '加载反馈失败')
  } finally {
    feedbackLoading.value = false
  }
}

async function setFeedbackStatus(id: string, status: FeedbackStatus) {
  try {
    await feedbackApi.adminUpdateStatus(id, status)
    toast(status === 'resolved' ? '已标记处理' : '已恢复待处理')
    await loadFeedback()
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}

onMounted(() => { load(); loadHotTopics(); loadFeedback() })

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

// ---- 热门话题运营位管理 ----
const hotStats = ref<{ tag: string; count: number }[]>([])
const hotOverrides = ref<HotTopicOverride[]>([])
const hotLoading = ref(false)
const hotForm = ref({ text: '', tag: '', action: 'pin' as 'pin' | 'block' })

async function loadHotTopics() {
  hotLoading.value = true
  try {
    const res = await communityApi.adminHotTopics()
    hotStats.value = res.stats
    hotOverrides.value = res.overrides
  } catch (e: any) {
    toast(e?.message || '加载热门话题失败')
  } finally {
    hotLoading.value = false
  }
}

async function pinOrBlockHot(tag: string, action: 'pin' | 'block') {
  try {
    await communityApi.adminAddHotTopic({ text: tag, tag, action })
    toast(action === 'pin' ? '已置顶展示' : '已从自动统计屏蔽')
    await loadHotTopics()
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function addHotTopic() {
  const f = hotForm.value
  if (!f.text.trim() || !f.tag.trim()) { toast('请填写文案与 tag'); return }
  try {
    await communityApi.adminAddHotTopic({ text: f.text.trim(), tag: f.tag.trim(), action: f.action })
    hotForm.value = { text: '', tag: '', action: 'pin' }
    toast('已添加')
    await loadHotTopics()
  } catch (e: any) { toast(e?.message || '添加失败') }
}

async function removeHotTopic(id: string) {
  try {
    await communityApi.adminDeleteHotTopic(id)
    hotOverrides.value = hotOverrides.value.filter(o => o.id !== id)
    toast('已删除')
  } catch (e: any) { toast(e?.message || '删除失败') }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2.5" @click="goBack">← 返回</button>
      <h1 class="page-title">审核中心</h1>
      <span v-if="reports.length" class="text-xs px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-500">
        {{ reports.length }} 条待处理
      </span>
    </div>

    <div class="flex gap-1 border-b border-slate-100 dark:border-slate-700">
      <button v-for="t in (['reports','feedback','topics'] as const)" :key="t"
        class="px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors"
        :class="activeTab === t
          ? 'border-primary-500 text-primary-600 dark:text-primary-400 font-semibold'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
        @click="activeTab = t">
        {{ t === 'reports' ? '举报' : t === 'feedback' ? '反馈' : '热门话题' }}
      </button>
    </div>

    <div v-show="activeTab === 'reports'">
    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="!reports.length" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2"></div>
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
            <button v-if="r.targetType !== 'message'" class="btn-ghost !text-xs" @click="ask(r.id, 'hide')">隐藏</button>
            <button class="btn-ghost !text-xs !text-red-500" @click="ask(r.id, 'delete')">删除</button>
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

    <!-- 热门话题运营位管理 -->
    <div v-show="activeTab === 'topics'" class="card space-y-3">
      <div class="section-title !mb-0">热门话题管理</div>
      <div v-if="hotLoading" class="text-xs text-slate-400 text-center py-3">加载中…</div>
      <template v-else>
        <!-- 近 7 天自动统计 -->
        <div v-if="hotStats.length">
          <div class="text-[11px] text-slate-400 mb-1.5">近 7 天话题频次（可一键置顶/屏蔽）</div>
          <div class="flex flex-wrap gap-1.5">
            <div v-for="s in hotStats" :key="s.tag"
              class="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-50 dark:bg-slate-700/50 text-xs">
              <span>{{ s.tag }}</span>
              <span class="text-[10px] text-slate-400">{{ s.count }} 帖</span>
              <button class="text-[10px] text-primary-500 hover:underline" @click="pinOrBlockHot(s.tag, 'pin')">置顶</button>
              <button class="text-[10px] text-red-400 hover:underline" @click="pinOrBlockHot(s.tag, 'block')">屏蔽</button>
            </div>
          </div>
        </div>
        <div v-else class="text-xs text-slate-400">近 7 天暂无带话题的帖子</div>

        <!-- 手动添加 -->
        <div class="flex flex-wrap gap-2 items-center border-t border-slate-100 dark:border-slate-700 pt-3">
          <input v-model="hotForm.text" maxlength="20" class="input !py-1.5 !text-xs flex-1 min-w-[8rem]" placeholder="展示文案（≤20 字）" />
          <input v-model="hotForm.tag" maxlength="20" class="input !py-1.5 !text-xs flex-1 min-w-[8rem]" placeholder="关联 tag（如 #高等数学）" />
          <select v-model="hotForm.action" class="input !py-1.5 !text-xs !w-auto">
            <option value="pin">置顶</option>
            <option value="block">屏蔽</option>
          </select>
          <button class="btn-primary !text-xs" @click="addHotTopic">添加</button>
        </div>

        <!-- 现有干预名单 -->
        <div v-if="hotOverrides.length">
          <div class="text-[11px] text-slate-400 mb-1.5">干预名单</div>
          <div class="space-y-1">
            <div v-for="o in hotOverrides" :key="o.id" class="flex items-center gap-2 text-xs">
              <span class="px-1.5 py-0.5 rounded font-medium"
                :class="o.action === 'pin' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600' : 'bg-red-50 dark:bg-red-900/30 text-red-500'">
                {{ o.action === 'pin' ? '置顶' : '屏蔽' }}
              </span>
              <span class="font-medium">{{ o.text }}</span>
              <span class="text-slate-400">{{ o.tag }}</span>
              <button class="ml-auto text-[10px] text-red-400 hover:underline" @click="removeHotTopic(o.id)">删除</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 意见反馈管理 -->
    <div v-show="activeTab === 'feedback'" class="space-y-3">
      <div class="flex items-center gap-2">
        <button v-for="f in (['all','pending','resolved'] as const)" :key="f"
          class="px-2.5 py-1 rounded-full text-xs border"
          :class="feedbackFilter === f
            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-800'
            : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'"
          @click="feedbackFilter = f; loadFeedback()">
          {{ f === 'all' ? '全部' : f === 'pending' ? '待处理' : '已处理' }}
        </button>
      </div>

      <div v-if="feedbackLoading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
      <div v-else-if="!feedbacks.length" class="card text-center py-10 text-slate-400 text-sm">
        <div class="text-3xl mb-2"></div><p>暂无反馈</p>
      </div>
      <template v-else>
        <div v-for="fb in feedbacks" :key="fb.id" class="card space-y-2">
          <div class="flex items-center gap-2 text-xs text-slate-400">
            <span class="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-500 font-medium">{{ FB_TYPE_LABEL[fb.type] }}</span>
            <span>{{ fb.userName }}</span>
            <span>{{ fromNow(fb.createdAt) }}</span>
            <span class="ml-auto px-1.5 py-0.5 rounded"
              :class="fb.status === 'pending' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600' : 'bg-green-50 dark:bg-green-900/30 text-green-500'">
              {{ fb.status === 'pending' ? '待处理' : '已处理' }}
            </span>
          </div>
          <p class="text-sm whitespace-pre-wrap break-words">{{ fb.content }}</p>
          <div v-if="fb.imageUrls.length" class="flex gap-2">
            <img v-for="u in fb.imageUrls" :key="u" :src="imageUrl(u)" class="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
          </div>
          <div v-if="fb.contact" class="text-xs text-slate-500 dark:text-slate-400">联系方式：{{ fb.contact }}</div>
          <div class="flex gap-2 pt-1">
            <button class="btn-ghost !text-xs" @click="setFeedbackStatus(fb.id, fb.status === 'pending' ? 'resolved' : 'pending')">
              {{ fb.status === 'pending' ? '✅ 标记已处理' : '↩️ 恢复待处理' }}
            </button>
            <a v-if="fb.githubIssueUrl" :href="fb.githubIssueUrl" target="_blank" rel="noopener" class="btn-ghost !text-xs ml-auto">查看 GitHub Issue →</a>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
