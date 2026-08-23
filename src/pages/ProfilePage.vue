<script setup lang="ts">
/**
 * 个人主页（访客态/本人态通用）：社交资料 + 作品 + 学习履历可视化。
 * 公开信息：等级/积分/徽章墙/连续打卡/学习时长热力图/做题统计/科目分布。
 * 隐私控制：仅公开为主，后续可扩展可见性设置。
 */
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import { COMMUNITY_BADGES } from '../data/defaults'
import { sessionUser } from '../services/auth'
import StreakHeatmap from '../components/community/StreakHeatmap.vue'
import Modal from '../components/Modal.vue'
import ProfileHeader from '../components/profile/ProfileHeader.vue'
import SocialStatsBar from '../components/profile/SocialStatsBar.vue'
import UserWorksTabs from '../components/profile/UserWorksTabs.vue'
import EditProfileModal from '../components/profile/EditProfileModal.vue'
import type { CommunityUserProfile, UserStudyStats } from '../types'

const route = useRoute()
const router = useRouter()

const userId = route.params.id as string

const profile = ref<CommunityUserProfile | null>(null)
const stats = ref<UserStudyStats | null>(null)
const loading = ref(true)
const error = ref('')
const worksTab = ref<'posts' | 'likes'>('posts')
const showEdit = ref(false)

const isSelf = computed(() => userId === (sessionUser.value?.id ?? ''))
/** 私密主页降级视图：profile 仅含公开子集（昵称/头像/蓝V/关注状态），学习数据与作品缺省 */
const profilePrivate = computed(() => !!profile.value?.profilePrivate)

// 热力图点击：查看选中日期的学习总时长（公开数据，与首页热力图交互一致）
const heatDate = ref('')
const heatMinutes = computed(() => {
  if (!heatDate.value || !stats.value?.heatmap) return 0
  return stats.value.heatmap.find(h => h.date === heatDate.value)?.minutes ?? 0
})

/** 分钟格式化：X 小时 Y 分钟 */
function formatMinutes(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

// 徽章目录：已获得的高亮，未获得的置灰
const earnedKeys = computed(() => new Set(profile.value?.badges?.map(b => b.key) ?? []))

// 学习时长格式化
const totalHours = computed(() => Math.floor((stats.value?.totalStudy.minutes ?? 0) / 60))
const totalMinutes = computed(() => (stats.value?.totalStudy.minutes ?? 0) % 60)
const monthHours = computed(() => Math.floor((stats.value?.monthStudy.minutes ?? 0) / 60))
const monthMinutes = computed(() => (stats.value?.monthStudy.minutes ?? 0) % 60)

// profile 与 stats 分开加载：私密主页（非本人）时 stats 会 403，但不阻塞资料卡与关注按钮渲染
async function loadAll() {
  try {
    profile.value = await communityApi.profile(userId)
  } catch (e: any) {
    if (e?.status === 403) error.value = '对方设置了主页仅自己可见'
    else error.value = '用户不存在或已注销'
    loading.value = false
    return
  }
  // 私密主页降级视图：跳过学习统计加载（接口会 403）
  if (!profile.value.profilePrivate) {
    try {
      stats.value = await communityApi.stats(userId)
    } catch {
      stats.value = null // 统计加载失败不阻塞主页展示
    }
  }
  loading.value = false
}

// FollowButton 乐观更新后的受控回写：同步关注状态 / 粉丝数 / 关系
function onFollowChange(following: boolean) {
  const p = profile.value
  if (!p) return
  p.followedByMe = following
  // 降级视图缺少 followers 字段（undefined），跳过计数修正避免产生 NaN
  if (typeof p.followers === 'number') p.followers += following ? 1 : -1
  p.relation = p.followedByMe && p.followsMe ? 'mutual'
    : p.followedByMe ? 'following' : p.followsMe ? 'follower' : 'none'
}

/** 返回上一级路由；直接打开（无站内历史）时回退到广场 */
function goBack() {
  if (history.state?.back) router.back()
  else router.push('/community')
}

onMounted(loadAll)
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- 返回导航 -->
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" @click="goBack">← 返回</button>
      <h2 class="text-lg font-bold flex-1">主页</h2>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="text-center text-xs text-slate-400 py-20">加载中…</div>

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
      <div class="card">
        <h3 class="text-sm font-bold mb-3">📊 学习概览</h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
            <div class="text-lg font-bold text-blue-600">
              {{ totalHours }}<span class="text-sm font-normal">h</span> {{ totalMinutes }}<span class="text-sm font-normal">m</span>
            </div>
            <div class="text-xs text-slate-400">总学习时长</div>
            <div class="text-[10px] text-slate-400">{{ stats?.totalStudy.days }} 天</div>
          </div>
          <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
            <div class="text-lg font-bold text-green-600">{{ stats?.problems.total ?? 0 }}</div>
            <div class="text-xs text-slate-400">总做题数</div>
            <div class="text-[10px] text-slate-400">正确率 {{ stats?.problems.accuracy ?? 0 }}%</div>
          </div>
          <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
            <div class="text-lg font-bold text-blue-600">
              {{ monthHours }}<span class="text-sm font-normal">h</span> {{ monthMinutes }}<span class="text-sm font-normal">m</span>
            </div>
            <div class="text-xs text-slate-400">本月学习</div>
          </div>
        </div>
      </div>

      <!-- 学习热力图 -->
      <div class="card">
        <h3 class="text-sm font-bold mb-3">学习热力图（近 30 周）</h3>
        <StreakHeatmap v-if="stats?.heatmap" :data="stats.heatmap" @select="heatDate = $event" />
        <p class="text-[10px] text-slate-400 mt-2">点击色块可查看当日学习时长</p>
      </div>

      <!-- 科目分布 -->
      <div class="card" v-if="stats?.subjects?.length">
        <h3 class="text-sm font-bold mb-3">📚 科目学习分布</h3>
        <div class="space-y-2">
          <div v-for="s in stats.subjects" :key="s.id" class="flex items-center gap-2">
            <span class="text-sm w-20 truncate">{{ s.name }}</span>
            <div class="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-2.5">
              <div class="bg-blue-500 h-2.5 rounded-full transition-all"
                :style="{ width: `${Math.min(s.minutes / (stats.subjects[0]?.minutes || 1) * 100, 100)}%` }" />
            </div>
            <span class="text-xs text-slate-400 w-16 text-right">{{ Math.floor(s.minutes / 60) }}h {{ s.minutes % 60 }}m</span>
          </div>
        </div>
      </div>

      <!-- 徽章墙 -->
      <div class="card">
        <h3 class="text-sm font-bold mb-3">🏅 徽章墙</h3>
        <div v-if="!profile.badges?.length" class="text-xs text-slate-400 py-2">
          还没有获得徽章。多发帖、多提问、坚持打卡来解锁吧！
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div v-for="badgeDef in COMMUNITY_BADGES" :key="badgeDef.key"
            class="flex items-center gap-2 p-2 rounded-lg transition-colors"
            :class="earnedKeys.has(badgeDef.key)
              ? 'bg-amber-50 dark:bg-amber-900/20'
              : 'opacity-40 grayscale'">
            <span class="text-xl">{{ badgeDef.icon }}</span>
            <div class="min-w-0">
              <div class="text-xs font-semibold truncate">{{ badgeDef.name }}</div>
              <div class="text-[10px] text-slate-400 truncate">{{ badgeDef.desc }}</div>
            </div>
          </div>
        </div>
      </div>
      </template>
    </template>

    <!-- 编辑资料弹窗（仅本人态经 ProfileHeader 触发打开） -->
    <EditProfileModal v-model:show="showEdit" @saved="loadAll" />

    <!-- 热力图当日学习时长弹窗 -->
    <Modal :title="`${heatDate} 学习记录`" :show="!!heatDate" @close="heatDate = ''">
      <div class="flex items-center justify-between bg-primary-50 dark:bg-primary-900/30 rounded-xl px-4 py-3">
        <span class="text-sm text-slate-500 dark:text-slate-400">当日学习总时长</span>
        <span class="text-xl font-black text-primary-500">{{ formatMinutes(heatMinutes) }}</span>
      </div>
      <p class="text-xs text-slate-400 text-center pt-3">{{ heatMinutes > 0 ? '具体科目明细仅本人可见' : '当日未学习' }}</p>
    </Modal>
  </div>
</template>
