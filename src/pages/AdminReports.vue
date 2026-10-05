<script setup lang="ts">
import { Check, Undo2, ArrowLeft, ArrowRight } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import LoadingState from '../shared/components/LoadingState.vue'
import AsyncState from '../shared/components/AsyncState.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useRouter } from 'vue-router'
import { moderationApi } from '../api/community/moderation'
import { imageUrl } from '../api/community'
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
const toast = useToast()

const reports = ref<AdminReport[]>([])
const reportsHasMore = ref(false)
const reportsCursor = ref<string | null>(null)
const reportsLoadingMore = ref(false)
const reportsMoreError = ref('')
let reportRequest = 0
const loading = ref(true)
/** 正在确认处理的举报：记录动作与说明 */
const confirming = ref<{ id: string; action: 'hide' | 'delete' | 'reject' } | null>(null)
const note = ref('')
const submitting = ref(false)

// ---- Tab 切换（举报 / 反馈 / 热门话题） ----
const activeTab = ref<'reports' | 'feedback' | 'topics'>('reports')

// ---- 意见反馈管理 ----
const FB_TYPE_LABEL: Record<Feedback['type'], string> = {
  feature: '功能建议',
  bug: '问题反馈',
  experience: '体验评价',
  other: '其他'
}
const feedbacks = ref<Feedback[]>([])
const feedbackLoading = ref(false)
const feedbackHasMore = ref(false)
const feedbackCursor = ref<string | null>(null)
const feedbackLoadingMore = ref(false)
const feedbackMoreError = ref('')
let feedbackRequest = 0
const feedbackFilter = ref<'all' | FeedbackStatus>('all')

const feedbackError = ref('')
async function loadFeedback(reset = true) {
  if (!reset && (feedbackLoading.value || feedbackLoadingMore.value || !feedbackCursor.value)) return
  const request = ++feedbackRequest
  if (reset) {
    feedbackError.value = ''
    feedbackLoading.value = true
    feedbackCursor.value = null
    feedbackHasMore.value = false
  } else feedbackLoadingMore.value = true
  feedbackMoreError.value = ''
  try {
    const res = await feedbackApi.adminList(
      feedbackFilter.value === 'all' ? undefined : feedbackFilter.value,
      reset ? undefined : (feedbackCursor.value ?? undefined)
    )
    if (request !== feedbackRequest) return
    feedbacks.value = reset
      ? res.feedbacks
      : [...new Map([...feedbacks.value, ...res.feedbacks].map((f) => [f.id, f])).values()]
    feedbackCursor.value = res.nextCursor ?? null
    feedbackHasMore.value = !!res.hasMore && !!feedbackCursor.value
  } catch (e) {
    if (request !== feedbackRequest) return
    if (reset) feedbackError.value = getErrorMessage(e, '加载反馈失败，请重试')
    else feedbackMoreError.value = getErrorMessage(e, '更多反馈未能加载，请重试')
  } finally {
    if (request === feedbackRequest) {
      feedbackLoading.value = false
      feedbackLoadingMore.value = false
    }
  }
}

async function setFeedbackStatus(id: string, status: FeedbackStatus) {
  try {
    await feedbackApi.adminUpdateStatus(id, status)
    toast(status === 'resolved' ? '已标记处理' : '已恢复待处理')
    await loadFeedback()
  } catch (e) {
    toast(getErrorMessage(e, '反馈状态未能更新，请重试'))
  }
}

onMounted(() => {
  load()
  loadHotTopics()
  loadFeedback()
})
onBeforeUnmount(() => {
  reportRequest++
  feedbackRequest++
})

const reportError = ref('')
async function load(reset = true) {
  if (!reset && (loading.value || reportsLoadingMore.value || !reportsCursor.value)) return
  const request = ++reportRequest
  if (reset) {
    reportError.value = ''
    loading.value = true
    reportsCursor.value = null
    reportsHasMore.value = false
  } else reportsLoadingMore.value = true
  reportsMoreError.value = ''
  try {
    const res = await moderationApi.adminReports(reset ? undefined : (reportsCursor.value ?? undefined))
    if (request !== reportRequest) return
    reports.value = reset
      ? res.reports
      : [...new Map([...reports.value, ...res.reports].map((r) => [r.id, r])).values()]
    reportsCursor.value = res.nextCursor ?? null
    reportsHasMore.value = !!res.hasMore && !!reportsCursor.value
  } catch (e) {
    if (request !== reportRequest) return
    if (reset) reportError.value = getErrorMessage(e, '加载失败，请重试')
    else reportsMoreError.value = getErrorMessage(e, '更多举报未能加载，请重试')
  } finally {
    if (request === reportRequest) {
      loading.value = false
      reportsLoadingMore.value = false
    }
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
    await moderationApi.adminResolveReport(confirming.value.id, confirming.value.action, note.value.trim() || undefined)
    reports.value = reports.value.filter((r) => r.id !== confirming.value!.id)
    toast('已处理并通知当事人')
    confirming.value = null
  } catch (e) {
    toast(getErrorMessage(e, '处理失败'))
  } finally {
    submitting.value = false
  }
}

// ---- 热门话题运营位管理 ----
const hotStats = ref<{ tag: string; count: number }[]>([])
const hotOverrides = ref<HotTopicOverride[]>([])
const hotLoading = ref(false)
const hotForm = ref({ text: '', tag: '', action: 'pin' as 'pin' | 'block' })

const hotError = ref('')
async function loadHotTopics() {
  hotError.value = ''
  hotLoading.value = true
  try {
    const res = await moderationApi.adminHotTopics()
    hotStats.value = res.stats
    hotOverrides.value = res.overrides
  } catch (e) {
    hotError.value = getErrorMessage(e, '加载热门话题失败，请重试')
  } finally {
    hotLoading.value = false
  }
}

async function pinOrBlockHot(tag: string, action: 'pin' | 'block') {
  try {
    await moderationApi.adminAddHotTopic({ text: tag, tag, action })
    toast(action === 'pin' ? '已置顶展示' : '已从自动统计屏蔽')
    await loadHotTopics()
  } catch (e) {
    toast(getErrorMessage(e, '热门话题未能更新，请重试'))
  }
}

async function addHotTopic() {
  const f = hotForm.value
  if (!f.text.trim() || !f.tag.trim()) {
    toast('请填写展示文字和话题标签')
    return
  }
  try {
    await moderationApi.adminAddHotTopic({ text: f.text.trim(), tag: f.tag.trim(), action: f.action })
    hotForm.value = { text: '', tag: '', action: 'pin' }
    toast('已添加')
    await loadHotTopics()
  } catch (e) {
    toast(getErrorMessage(e, '添加失败'))
  }
}

async function removeHotTopic(id: string) {
  try {
    await moderationApi.adminDeleteHotTopic(id)
    hotOverrides.value = hotOverrides.value.filter((o) => o.id !== id)
    toast('已删除')
  } catch (e) {
    toast(getErrorMessage(e, '删除失败'))
  }
}
</script>

<template>
  <div class="study-page reading-page space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="arrow-action" @click="goBack"
        ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
      >
      <h1 class="page-title">审核中心</h1>
      <span
        v-if="reports.length"
        class="text-xs px-2 py-0.5 rounded-full bg-correction-soft dark:bg-correction-soft text-correction"
      >
        {{ reports.length }} 条待处理
      </span>
    </div>

    <div class="flex gap-1 border-b border-slate-100 dark:border-slate-700">
      <button
        v-for="t in ['reports', 'feedback', 'topics'] as const"
        :key="t"
        class="px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors"
        :class="
          activeTab === t
            ? 'border-primary-500 text-action dark:text-action font-semibold'
            : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        "
        :aria-pressed="activeTab === t"
        @click="activeTab = t"
      >
        {{ t === 'reports' ? '举报' : t === 'feedback' ? '反馈' : '热门话题' }}
      </button>
    </div>

    <div v-show="activeTab === 'reports'">
      <LoadingState v-if="loading" />
      <AsyncState v-else-if="reportError" :error="reportError" @retry="load" />
      <div v-else-if="!reports.length && !reportsHasMore" class="card text-center py-10 text-slate-400 text-sm">
        <p>举报已处理完。新的举报会显示在这里。</p>
      </div>

      <div v-else class="space-y-3">
        <div v-for="r in reports" :key="r.id" class="card space-y-2">
          <div class="flex items-center gap-2 text-xs text-slate-400">
            <span class="px-1.5 py-0.5 rounded bg-action-soft dark:bg-action-soft text-action font-medium">{{
              r.reason
            }}</span>
            <span>{{ TYPE_TEXT[r.targetType] }}</span>
            <span>{{ r.reporterName }} 举报</span>
            <span class="ml-auto">{{ fromNow(r.createdAt) }}</span>
          </div>

          <div v-if="r.target" class="rounded-lg bg-slate-50 dark:bg-slate-700/40 px-3 py-2">
            <div class="text-xs text-slate-400 mb-0.5">
              {{ r.target.authorName }} 的{{ TYPE_TEXT[r.targetType] }}
              <span v-if="r.target.isHidden" class="text-correction ml-1">（已隐藏）</span>
            </div>
            <p class="text-sm whitespace-pre-wrap break-words">{{ r.target.excerpt }}</p>
            <span
              v-if="r.target.postId"
              class="text-xs text-action mt-1 arrow-action"
              @click="router.push(`/community/post/${r.target.postId}`)"
            >
              查看原帖
              <IconAction
                :icon="ArrowRight"
                label="查看原帖"
                @click="router.push(`/community/post/${r.target.postId}`)"
              />
            </span>
            <div v-else-if="r.targetType === 'message'" class="text-xs text-slate-400 mt-1">
              私信仅会话双方可见，可按内容预览与举报说明判断
            </div>
          </div>
          <div v-else class="text-xs text-slate-400 px-1">目标内容已被作者删除</div>

          <p v-if="r.detail" class="text-xs text-slate-500 dark:text-slate-400">补充说明：{{ r.detail }}</p>

          <!-- 处理操作 -->
          <div v-if="confirming?.id !== r.id" class="flex gap-2 pt-1">
            <template v-if="r.target">
              <!-- 私信不支持隐藏（仅会话双方可见），服务端会拒绝；只提供删除/驳回 -->
              <button v-if="r.targetType !== 'message'" class="btn-ghost !text-xs" @click="ask(r.id, 'hide')">
                隐藏
              </button>
              <button class="btn-ghost !text-xs !text-correction" @click="ask(r.id, 'delete')">删除</button>
            </template>
            <button v-else class="btn-ghost !text-xs" @click="ask(r.id, 'delete')">✅ 结案</button>
            <button class="btn-ghost !text-xs ml-auto" @click="ask(r.id, 'reject')">驳回举报</button>
          </div>
          <div v-else class="space-y-2 pt-1">
            <input
              v-model="note"
              maxlength="200"
              class="input !py-1.5 text-xs"
              :placeholder="`处理说明（可选，将随通知发给当事人）`"
            />
            <div class="flex gap-2 justify-end">
              <button class="btn-ghost !text-xs" @click="confirming = null">取消</button>
              <button class="btn-primary !text-xs" :disabled="submitting" @click="confirmResolve">
                确认{{ confirming.action === 'delete' && !r.target ? '结案' : ACTION_TEXT[confirming.action] }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="reportsHasMore" class="text-center space-y-2">
          <p v-if="!reports.length" class="text-xs text-muted">还有待处理举报，可加载下一页继续审核。</p>
          <p v-if="reportsMoreError" role="alert" class="text-xs text-correction">{{ reportsMoreError }}</p>
          <button class="btn-ghost !text-xs" :disabled="reportsLoadingMore" @click="load(false)">
            {{ reportsLoadingMore ? '加载中…' : '加载更多举报' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 热门话题运营位管理 -->
    <div v-show="activeTab === 'topics'" class="card space-y-3">
      <div class="section-title !mb-0">热门话题管理</div>
      <LoadingState v-if="hotLoading" />
      <AsyncState v-else-if="hotError" :error="hotError" @retry="loadHotTopics" />
      <template v-else>
        <!-- 近 7 天自动统计 -->
        <div v-if="hotStats.length">
          <div class="text-xs text-slate-400 mb-1.5">近 7 天话题频次（可一键置顶/屏蔽）</div>
          <div class="flex flex-wrap gap-1.5">
            <div
              v-for="s in hotStats"
              :key="s.tag"
              class="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-50 dark:bg-slate-700/50 text-xs"
            >
              <span>{{ s.tag }}</span>
              <span class="text-xs text-slate-400">{{ s.count }} 帖</span>
              <button class="text-xs text-action hover:underline" @click="pinOrBlockHot(s.tag, 'pin')">置顶</button>
              <button class="text-xs text-correction hover:underline" @click="pinOrBlockHot(s.tag, 'block')">
                屏蔽
              </button>
            </div>
          </div>
        </div>
        <div v-else class="text-xs text-slate-400">近 7 天还没有带话题的讨论。</div>

        <!-- 手动添加 -->
        <div class="flex flex-wrap gap-2 items-center border-t border-slate-100 dark:border-slate-700 pt-3">
          <input
            v-model="hotForm.text"
            maxlength="20"
            class="input !py-1.5 !text-xs flex-1 min-w-[8rem]"
            aria-label="展示文案（≤20 字）"
            placeholder="展示文案（≤20 字）"
          />
          <input
            v-model="hotForm.tag"
            maxlength="20"
            class="input !py-1.5 !text-xs flex-1 min-w-[8rem]"
            aria-label="关联 tag（如 #高等数学）"
            placeholder="关联 tag（如 #高等数学）"
          />
          <select v-model="hotForm.action" class="input !py-1.5 !text-xs !w-auto">
            <option value="pin">置顶</option>
            <option value="block">屏蔽</option>
          </select>
          <button class="btn-primary !text-xs" @click="addHotTopic">添加</button>
        </div>

        <!-- 现有干预名单 -->
        <div v-if="hotOverrides.length">
          <div class="text-xs text-slate-400 mb-1.5">干预名单</div>
          <div class="space-y-1">
            <div v-for="o in hotOverrides" :key="o.id" class="flex items-center gap-2 text-xs">
              <span
                class="px-1.5 py-0.5 rounded font-medium"
                :class="
                  o.action === 'pin'
                    ? 'bg-action-soft dark:bg-action-soft text-action'
                    : 'bg-correction-soft dark:bg-correction-soft text-correction'
                "
              >
                {{ o.action === 'pin' ? '置顶' : '屏蔽' }}
              </span>
              <span class="font-medium">{{ o.text }}</span>
              <span class="text-slate-400">{{ o.tag }}</span>
              <button class="ml-auto text-xs text-correction hover:underline" @click="removeHotTopic(o.id)">
                删除
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 意见反馈管理 -->
    <div v-show="activeTab === 'feedback'" class="space-y-3">
      <div class="flex items-center gap-2">
        <button
          v-for="f in ['all', 'pending', 'resolved'] as const"
          :key="f"
          class="px-2.5 py-1 rounded-full text-xs border"
          :class="
            feedbackFilter === f
              ? 'bg-primary-50 dark:bg-primary-900/30 text-action dark:text-action border-primary-200 dark:border-primary-800'
              : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
          "
          :aria-pressed="feedbackFilter === f"
          @click="
            () => {
              feedbackFilter = f
              loadFeedback()
            }
          "
        >
          {{ f === 'all' ? '全部' : f === 'pending' ? '待处理' : '已处理' }}
        </button>
      </div>

      <LoadingState v-if="feedbackLoading" />
      <AsyncState v-else-if="feedbackError" :error="feedbackError" @retry="loadFeedback" />
      <div v-else-if="!feedbacks.length" class="card text-center py-10 text-slate-400 text-sm">
        <p>还没有反馈。收到后可在这里查看和处理。</p>
      </div>
      <template v-else>
        <div v-for="fb in feedbacks" :key="fb.id" class="card space-y-2">
          <div class="flex items-center gap-2 text-xs text-slate-400">
            <span class="px-1.5 py-0.5 rounded bg-action-soft dark:bg-action-soft text-action font-medium">{{
              FB_TYPE_LABEL[fb.type]
            }}</span>
            <span>{{ fb.userName }}</span>
            <span>{{ fromNow(fb.createdAt) }}</span>
            <span
              class="ml-auto px-1.5 py-0.5 rounded"
              :class="
                fb.status === 'pending'
                  ? 'bg-action-soft dark:bg-action-soft text-action'
                  : 'bg-action-soft dark:bg-action-soft text-action'
              "
            >
              {{ fb.status === 'pending' ? '待处理' : '已处理' }}
            </span>
          </div>
          <p class="text-sm whitespace-pre-wrap break-words">{{ fb.content }}</p>
          <div v-if="fb.imageUrls.length" class="flex gap-2">
            <img
              v-for="u in fb.imageUrls"
              :key="u"
              :src="imageUrl(u)"
              class="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
              alt="反馈截图"
            />
          </div>
          <div v-if="fb.contact" class="text-xs text-slate-500 dark:text-slate-400">联系方式：{{ fb.contact }}</div>
          <div class="flex gap-2 pt-1">
            <span
              class="!text-xs arrow-action"
              @click="setFeedbackStatus(fb.id, fb.status === 'pending' ? 'resolved' : 'pending')"
            >
              <IconAction
                :icon="fb.status === 'pending' ? Check : Undo2"
                :label="`${fb.status === 'pending' ? '标记已处理' : '恢复待处理'}`"
                @click="setFeedbackStatus(fb.id, fb.status === 'pending' ? 'resolved' : 'pending')"
              />
              {{ fb.status === 'pending' ? '标记已处理' : '恢复待处理' }}
            </span>
            <a
              v-if="fb.githubIssueUrl"
              :href="fb.githubIssueUrl"
              target="_blank"
              rel="noopener"
              class="!text-xs ml-auto arrow-link"
              >查看 GitHub Issue <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
            /></a>
          </div>
        </div>
        <div v-if="feedbackHasMore" class="text-center space-y-2">
          <p v-if="feedbackMoreError" role="alert" class="text-xs text-correction">{{ feedbackMoreError }}</p>
          <button class="btn-ghost !text-xs" :disabled="feedbackLoadingMore" @click="loadFeedback(false)">
            {{ feedbackLoadingMore ? '加载中…' : '加载更多反馈' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
