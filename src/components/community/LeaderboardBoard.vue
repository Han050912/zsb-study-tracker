<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../../api/community'
import { levelOf } from '../../data/defaults'
import type { CommunityLeaderboard } from '../../types'
import UserAvatar from './UserAvatar.vue'

/** 每日打卡榜：今日打卡榜 TOP 10 + 连续打卡王 TOP 5（广场顶部正向 peer pressure） */
const data = ref<CommunityLeaderboard | null>(null)

onMounted(async () => {
  try {
    data.value = await communityApi.leaderboard()
  } catch { /* 榜单加载失败不阻塞广场 */ }
})

const router = useRouter()
const MEDALS = ['🥇', '🥈', '🥉']
const medal = (i: number) => MEDALS[i] ?? `${i + 1}.`
/** 跳转用户成长主页 */
function goProfile(userId: string) {
  router.push(`/profile/${userId}`)
}
</script>

<template>
  <div v-if="data && (data.today.length || data.streak.length)" class="space-y-3">
    <!-- 今日打卡榜 -->
    <div v-if="data.today.length">
      <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">今日打卡榜</div>
      <div class="space-y-1.5">
        <div v-for="(e, i) in data.today" :key="i" class="flex items-center gap-2 text-xs">
          <span class="w-6 text-center shrink-0">{{ medal(i) }}</span>
          <div class="flex items-center gap-2 cursor-pointer group" @click="goProfile(e.userId)">
            <UserAvatar :name="e.userName" :avatar="e.userAvatar" size="sm" />
            <span class="font-medium truncate max-w-[7rem] group-hover:text-primary-500">{{ e.userName }}</span>
          </div>
          <span v-if="e.verified" class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0" title="认证专家">✓</span>
          <span class="text-[10px] px-1 rounded-full shrink-0"
            :style="{ background: levelOf(e.totalPoints).color + '1a', color: levelOf(e.totalPoints).color }">
            {{ levelOf(e.totalPoints).name }}
          </span>
          <span class="text-slate-400 truncate">{{ e.subjects.join('、') }}</span>
          <span class="ml-auto text-primary-500 font-semibold shrink-0">+{{ e.todayPoints }}</span>
        </div>
      </div>
    </div>
    <!-- 连续打卡王 -->
    <div v-if="data.streak.length">
      <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">连续打卡</div>
      <div class="flex flex-wrap gap-2">
        <div v-for="(e, i) in data.streak" :key="i"
          class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-50 dark:bg-slate-700/50 text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
          @click="goProfile(e.userId)">
          <UserAvatar :name="e.userName" :avatar="e.userAvatar" size="sm" />
          <span class="font-medium max-w-[5rem] truncate">{{ e.userName }}</span>
          <span v-if="e.verified" class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0" title="认证专家">✓</span>
          <span class="text-orange-500 font-semibold shrink-0">{{ e.streak }}天</span>
        </div>
      </div>
    </div>
  </div>
</template>
