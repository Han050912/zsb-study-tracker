<script setup lang="ts">
import IconAction from '../shared/components/IconAction.vue'
import LoadingState from '../shared/components/LoadingState.vue'
/**
 * 个人主页（访客态/本人态通用）：社交资料 + 作品 + 学习履历可视化。
 * 学习数据由本人主动公开；社交资料与作品沿用主页可见性。
 */
import { onUnmounted, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usersApi } from '../api/community/users'
import { TriangleAlert, ArrowLeft } from '@lucide/vue'
import { COMMUNITY_BADGES } from '../data/defaults'
import { sessionUser } from '../services/auth'
import { formatMinutes } from '../utils/date'
import StreakHeatmap from '../components/community/StreakHeatmap.vue'
import Modal from '../components/Modal.vue'
import ProfileHeader from '../components/profile/ProfileHeader.vue'
import SocialStatsBar from '../components/profile/SocialStatsBar.vue'
import UserWorksTabs from '../components/profile/UserWorksTabs.vue'
import EditProfileModal from '../components/profile/EditProfileModal.vue'
import { useBack } from '../composables/useBack'
import type { CommunityUserProfile, UserStudyStats } from '../types'

const route = useRoute()
const { goBack } = useBack()

const userId = computed(() => String(route.params.id ?? ''))

const profile = ref<CommunityUserProfile | null>(null)
const stats = ref<UserStudyStats | null>(null)
/** 学习统计加载失败：不用 0 兜底，展示「学习数据加载失败，点击重试」（概览与热力图区域） */
const statsError = ref(false)
const statsLoading = ref(false)
const loading = ref(true)
const error = ref('')
const worksTab = ref<'posts' | 'likes'>('posts')
const showEdit = ref(false)

const isSelf = computed(() => userId.value === (sessionUser.value?.id ?? ''))
/** 私密主页降级视图：profile 仅含公开子集（昵称/头像/蓝V/关注状态），学习数据与作品缺省 */
const profilePrivate = computed(() => !!profile.value?.profilePrivate)
const canViewLearningStats = computed(() => isSelf.value || profile.value?.learningStatsPrivate === false)

// 热力图点击：查看选中日期的学习总时长（公开数据，与首页热力图交互一致）
const heatDate = ref('')
const heatMinutes = computed(() => {
  if (!heatDate.value || !stats.value?.heatmap) return 0
  return stats.value.heatmap.find((h) => h.date === heatDate.value)?.minutes ?? 0
})

// 徽章目录：已获得的高亮，未获得的置灰
const earnedKeys = computed(() => new Set(profile.value?.badges?.map((b) => b.key) ?? []))

// 学习时长格式化
const totalHours = computed(() => Math.floor((stats.value?.totalStudy.minutes ?? 0) / 60))
const totalMinutes = computed(() => (stats.value?.totalStudy.minutes ?? 0) % 60)
const monthHours = computed(() => Math.floor((stats.value?.monthStudy.minutes ?? 0) / 60))
const monthMinutes = computed(() => (stats.value?.monthStudy.minutes ?? 0) % 60)

// profile 与 stats 分开加载：私密主页（非本人）时 stats 会 403，但不阻塞资料卡与关注按钮渲染
let profileTicket = 0
let statsTicket = 0
async function loadAll() {
  const ticket = ++profileTicket
  ++statsTicket
  const targetId = userId.value
  loading.value = true
  error.value = ''
  profile.value = null
  stats.value = null
  statsError.value = false
  statsLoading.value = false
  heatDate.value = ''
  try {
    const result = await usersApi.profile(targetId)
    if (ticket !== profileTicket) return
    profile.value = result
  } catch (e) {
    if (ticket !== profileTicket) return
    if ((e as { status?: number } | null)?.status === 403) error.value = '对方设置了主页仅自己可见'
    else error.value = '用户不存在或已注销'
    loading.value = false
    return
  }
  // 私密主页降级视图：跳过学习统计加载（接口会 403）
  if (!profile.value.profilePrivate && canViewLearningStats.value) await loadStats()
  if (ticket === profileTicket) loading.value = false
}

/** 学习统计单独加载/重试；失败置 statsError（统计与热力图区域显示错误态，不用 0 兜底） */
async function loadStats() {
  if (!canViewLearningStats.value) return
  const ticket = ++statsTicket
  const targetId = userId.value
  statsError.value = false
  statsLoading.value = true
  stats.value = null
  heatDate.value = ''
  try {
    const result = await usersApi.stats(targetId)
    if (ticket !== statsTicket) return
    stats.value = result
  } catch {
    if (ticket !== statsTicket) return
    statsError.value = true // 统计加载失败不阻塞主页展示，但明确告知失败
  } finally {
    if (ticket === statsTicket) statsLoading.value = false
  }
}

// FollowButton 乐观更新后的受控回写：同步关注状态 / 粉丝数 / 互关数 / 关系
function onFollowChange(following: boolean) {
  const p = profile.value
  if (!p) return
  const wasMutual = p.followedByMe && p.followsMe
  p.followedByMe = following
  // 降级视图缺少 followers/mutualCount 字段（undefined），跳过计数修正避免产生 NaN
  if (typeof p.followers === 'number') p.followers += following ? 1 : -1
  p.relation =
    p.followedByMe && p.followsMe ? 'mutual' : p.followedByMe ? 'following' : p.followsMe ? 'follower' : 'none'
  // 互相关注状态变化时同步「互关」数字，保证与四态标签同屏一致
  const isMutual = p.followedByMe && p.followsMe
  if (typeof p.mutualCount === 'number' && isMutual !== wasMutual) p.mutualCount += isMutual ? 1 : -1
}

watch(
  () => [userId.value, sessionUser.value?.id],
  () => void loadAll(),
  { immediate: true }
)
onUnmounted(() => {
  ++profileTicket
  ++statsTicket
})
</script>

<template>
  <div class="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
    <!-- 返回导航 -->
    <div class="flex items-center gap-2">
      <span class="arrow-action" @click="goBack"
        ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
      >
      <h1 class="page-title flex-1">主页</h1>
    </div>

    <!-- 加载中 -->
    <LoadingState v-if="loading" />

    <!-- 错误/不存在 -->
    <div v-else-if="error" class="card text-center py-20">
      <p class="text-slate-400">{{ error }}</p>
      <button class="btn mt-4" @click="goBack">返回</button>
    </div>

    <template v-else-if="profile">
      <!-- 社交资料头部（本人态显示编辑资料，访客态显示关注/私信） -->
      <ProfileHeader :profile="profile" :is-self="isSelf" @edit="showEdit = true" @follow-change="onFollowChange" />

      <!-- 私密主页降级视图：仅公开子集（昵称/头像/蓝V + 关注），学习数据与作品缺省 -->
      <div v-if="profilePrivate" class="card text-center py-10">
        <p class="text-slate-400 text-sm">该用户开启了主页隐私保护，仅展示公开资料</p>
      </div>

      <template v-else>
        <!-- 社交数据条 -->
        <SocialStatsBar :profile="profile" :is-self="isSelf" @show-works="worksTab = $event" />

        <!-- 作品 Tab（帖子 / 点赞） -->
        <UserWorksTabs :user-id="userId" :is-self="isSelf" v-model:active-tab="worksTab" />

        <!-- 学习概览：总学习时长 / 总做题数 / 本月学习 -->
        <p v-if="!canViewLearningStats" class="text-sm text-slate-500">该用户的学习数据仅本人可见。</p>
        <div v-if="canViewLearningStats" class="card">
          <h3 class="text-sm font-bold mb-3">学习概览</h3>
          <!-- 学习统计加载失败：不用 0 兜底，整块显示错误态 + 重试 -->
          <LoadingState v-if="statsLoading" />
          <button
            v-else-if="statsError"
            class="w-full flex items-center gap-2 text-xs text-correction dark:text-correction"
            @click="loadStats"
          >
            <TriangleAlert :size="14" aria-hidden="true" class="shrink-0" />
            <span class="flex-1 text-left">学习数据加载失败，点击重试</span>
          </button>
          <div v-else class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-action">
                {{ totalHours }}<span class="text-sm font-normal">小时</span> {{ totalMinutes
                }}<span class="text-sm font-normal">分钟</span>
              </div>
              <div class="text-xs text-slate-400">总学习时长</div>
              <div class="text-xs text-slate-400">{{ stats?.totalStudy.days }} 天</div>
            </div>
            <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-action">{{ stats?.problems.total ?? 0 }}</div>
              <div class="text-xs text-slate-400">总做题数</div>
              <div class="text-xs text-slate-400">
                {{ stats?.problems.total ? `正确率 ${stats.problems.accuracy}%` : '还没有做题记录' }}
              </div>
            </div>
            <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-action">
                {{ monthHours }}<span class="text-sm font-normal">小时</span> {{ monthMinutes
                }}<span class="text-sm font-normal">分钟</span>
              </div>
              <div class="text-xs text-slate-400">本月学习</div>
            </div>
          </div>
        </div>

        <!-- 学习热力图（统计失败时同样显示错误态，不渲染空热力图） -->
        <div v-if="canViewLearningStats" class="card">
          <h3 class="text-sm font-bold mb-3">近 30 周学习记录</h3>
          <LoadingState v-if="statsLoading" />
          <button
            v-else-if="statsError"
            class="w-full flex items-center gap-2 text-xs text-correction dark:text-correction"
            @click="loadStats"
          >
            <TriangleAlert :size="14" aria-hidden="true" class="shrink-0" />
            <span class="flex-1 text-left">学习数据加载失败，点击重试</span>
          </button>
          <template v-else>
            <StreakHeatmap v-if="stats?.heatmap" :data="stats.heatmap" @select="heatDate = $event" />
            <p class="text-xs text-slate-400 mt-2">选择日期查看时长；也可用方向键移动。</p>
          </template>
        </div>

        <!-- 科目分布 -->
        <div class="card" v-if="canViewLearningStats && stats?.subjects?.length">
          <h3 class="text-sm font-bold mb-3">科目学习分布</h3>
          <div class="space-y-2">
            <div v-for="s in stats.subjects" :key="s.id" class="flex items-center gap-2">
              <span class="text-sm w-20 truncate">{{ s.name }}</span>
              <div class="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-2.5">
                <div
                  class="bg-action h-2.5 rounded-full transition-colors"
                  :style="{ width: `${Math.min((s.minutes / (stats.subjects[0]?.minutes || 1)) * 100, 100)}%` }"
                />
              </div>
              <span class="text-xs text-slate-400 w-16 text-right"
                >{{ Math.floor(s.minutes / 60) }}h {{ s.minutes % 60 }}m</span
              >
            </div>
          </div>
        </div>

        <!-- 徽章墙 -->
        <div class="card">
          <h3 class="text-sm font-bold mb-3">徽章墙</h3>
          <div v-if="!profile.badges?.length" class="text-xs text-slate-400 py-2">
            还没有获得社区徽章。参与讨论或打卡后，可在这里查看。
          </div>
          <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              v-for="badgeDef in COMMUNITY_BADGES"
              :key="badgeDef.key"
              class="flex items-center gap-2 p-2 rounded-lg transition-colors"
              :class="earnedKeys.has(badgeDef.key) ? 'bg-action-soft dark:bg-action-soft' : 'bg-surface-soft'"
            >
              <span class="text-xl">{{ badgeDef.icon }}</span>
              <div class="min-w-0">
                <div class="text-xs font-semibold truncate">{{ badgeDef.name }}</div>
                <div class="text-xs text-muted">{{ badgeDef.desc }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- 编辑资料弹窗（仅本人态经 ProfileHeader 触发打开） -->
    <EditProfileModal v-model:show="showEdit" @saved="loadAll" />

    <!-- 热力图当日学习时长弹窗 -->
    <Modal :title="`${heatDate} 学习时长`" :show="canViewLearningStats && !!heatDate" @close="heatDate = ''">
      <div class="flex items-center justify-between bg-primary-50 dark:bg-primary-900/30 rounded-xl px-4 py-3">
        <span class="text-sm text-slate-500 dark:text-slate-400">当日学习总时长</span>
        <span class="text-xl font-black text-action">{{ formatMinutes(heatMinutes) }}</span>
      </div>
      <p class="text-xs text-slate-400 text-center pt-3">
        {{
          heatMinutes > 0
            ? isSelf
              ? '当日学习总时长包含学习记录和番茄专注。'
              : '仅展示公开的学习总时长，具体学习记录不对外公开。'
            : '当日暂无学习记录。'
        }}
      </p>
    </Modal>
  </div>
</template>
