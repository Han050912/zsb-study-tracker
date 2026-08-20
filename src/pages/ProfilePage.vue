<script setup lang="ts">
/**
 * 个人成长主页：学习履历可视化。
 * 公开信息：等级/积分/徽章墙/连续打卡/学习时长热力图/做题统计/科目分布。
 * 隐私控制：仅公开为主，后续可扩展可见性设置。
 */
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import { COMMUNITY_BADGES, levelOf, LEVELS } from '../data/defaults'
import { fromNow } from '../utils/date'
import { sessionUser } from '../services/auth'
import StreakHeatmap from '../components/community/StreakHeatmap.vue'
import UserAvatar from '../components/community/UserAvatar.vue'
import type { CommunityUserProfile, UserStudyStats } from '../types'

const route = useRoute()
const router = useRouter()

const userId = route.params.id as string

const profile = ref<CommunityUserProfile | null>(null)
const stats = ref<UserStudyStats | null>(null)
const loading = ref(true)
const error = ref('')

const level = computed(() => profile.value ? levelOf(profile.value.points) : LEVELS[0])

const isSelf = computed(() => userId === (sessionUser.value?.id ?? ''))

// 徽章目录：已获得的高亮，未获得的置灰
const earnedKeys = computed(() => new Set(profile.value?.badges?.map(b => b.key) ?? []))

// 学习时长格式化
const totalHours = computed(() => Math.floor((stats.value?.totalStudy.minutes ?? 0) / 60))
const totalMinutes = computed(() => (stats.value?.totalStudy.minutes ?? 0) % 60)
const monthHours = computed(() => Math.floor((stats.value?.monthStudy.minutes ?? 0) / 60))
const monthMinutes = computed(() => (stats.value?.monthStudy.minutes ?? 0) % 60)

onMounted(async () => {
  try {
    const [p, s] = await Promise.all([
      communityApi.profile(userId),
      communityApi.stats(userId)
    ])
    profile.value = p
    stats.value = s
  } catch (e: any) {
    if (e?.status === 403) error.value = '对方设置了主页仅自己可见'
    else if (e?.status === 401) error.value = '请登录后查看'
    else error.value = '用户不存在或已注销'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- 返回导航 -->
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" @click="router.push('/community')">← 广场</button>
      <h2 class="text-lg font-bold flex-1">📊 成长主页</h2>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="text-center text-xs text-slate-400 py-20">加载中…</div>

    <!-- 错误/不存在 -->
    <div v-else-if="error" class="card text-center py-20">
      <p class="text-slate-400">{{ error }}</p>
      <button class="btn mt-4" @click="router.push('/community')">返回广场</button>
    </div>

    <template v-else-if="profile">
      <!-- 用户信息头部 -->
      <div class="card">
        <div class="flex items-start gap-4">
          <UserAvatar :name="profile.userName" class="w-16 h-16 text-2xl" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-xl font-bold">{{ profile.userName }}</h1>
              <span v-if="profile.verified" class="text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full"
                title="专家认证">✅ 蓝 V</span>
              <span class="text-xs font-bold px-2 py-0.5 rounded-full"
                :style="{ background: level.color + '22', color: level.color }">
                {{ level.name }}
              </span>
            </div>
            <div class="text-sm text-slate-500 mt-1">
              💎 {{ profile.points }} 积分 · 🔥 {{ profile.streak }} 天连续打卡
            </div>
            <div v-if="profile.expertise" class="text-xs text-slate-400 mt-1">
              专长：{{ profile.expertise }}
            </div>
          </div>
          <!-- 编辑资料：仅自己可见 -->
          <button v-if="isSelf" class="btn-ghost text-xs" @click="router.push('/account')">
            编辑资料
          </button>
        </div>

        <!-- 统计卡片 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
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
            <div class="text-lg font-bold text-purple-600">{{ profile.postCount }}</div>
            <div class="text-xs text-slate-400">社区贡献</div>
            <div class="text-[10px] text-slate-400">获赞 {{ profile.likesReceived }}</div>
          </div>
          <div class="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
            <div class="text-lg font-bold text-amber-600">{{ profile.followers }}</div>
            <div class="text-xs text-slate-400">粉丝</div>
            <div class="text-[10px] text-slate-400">关注者</div>
          </div>
        </div>
      </div>

      <!-- 本月学习 -->
      <div class="card">
        <h3 class="text-sm font-bold mb-2">📅 本月学习</h3>
        <div class="text-2xl font-bold text-blue-600">
          {{ monthHours }}<span class="text-sm font-normal text-slate-400"> 小时 </span>{{ monthMinutes }}<span class="text-sm font-normal text-slate-400"> 分钟</span>
        </div>
      </div>

      <!-- 学习热力图 -->
      <div class="card">
        <h3 class="text-sm font-bold mb-3">🔥 学习热力图（近 365 天）</h3>
        <StreakHeatmap v-if="stats?.heatmap" :data="stats.heatmap" />
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
  </div>
</template>