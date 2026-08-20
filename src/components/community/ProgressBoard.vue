<script setup lang="ts">
/**
 * 学习进步榜（P1）：本周学习时长 / 本月刷题数 TOP 50，仅「参与学习进步榜」用户上榜。
 * 不展示末位排名；本人上榜高亮，未上榜显示排名与百分位；未参与显示开通引导。
 */
import { computed, onMounted, ref } from 'vue'
import { communityApi } from '../../api/community'
import { formatMinutes } from '../../utils/date'
import { levelOf } from '../../data/defaults'
import type { ProgressBoardData } from '../../types'
import UserAvatar from './UserAvatar.vue'

const data = ref<ProgressBoardData | null>(null)
const sub = ref<'weekMinutes' | 'monthProblems'>('weekMinutes')

onMounted(async () => {
  try { data.value = await communityApi.progressBoard() } catch { /* 静默降级 */ }
})

const board = computed(() => data.value ? data.value[sub.value] : null)
const MEDALS = ['🥇', '🥈', '🥉']
const medal = (i: number) => MEDALS[i] ?? `${i + 1}.`
</script>

<template>
  <div v-if="data" class="space-y-3">
    <!-- 子榜切换 -->
    <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs w-fit">
      <button class="px-3 py-1.5 rounded-md transition-colors"
        :class="sub === 'weekMinutes' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
        @click="sub = 'weekMinutes'">本周时长</button>
      <button class="px-3 py-1.5 rounded-md transition-colors"
        :class="sub === 'monthProblems' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
        @click="sub = 'monthProblems'">本月刷题</button>
    </div>

    <!-- 榜单 -->
    <div v-if="board?.list.length" class="space-y-1.5">
      <div v-for="(e, i) in board.list" :key="e.userId"
        class="flex items-center gap-2 text-xs rounded-lg px-1.5 py-1"
        :class="e.isMe ? 'bg-primary-50 dark:bg-primary-900/30' : ''">
        <span class="w-6 text-center shrink-0">{{ medal(i) }}</span>
        <UserAvatar :name="e.userName" size="sm" />
        <span class="font-medium truncate max-w-[7rem]" :class="e.isMe ? 'text-primary-600 dark:text-primary-300' : ''">{{ e.userName }}</span>
        <span v-if="e.verified" class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0" title="认证专家">✓</span>
        <span class="text-[10px] px-1 rounded-full shrink-0"
          :style="{ background: levelOf(e.totalPoints).color + '1a', color: levelOf(e.totalPoints).color }">
          {{ levelOf(e.totalPoints).name }}
        </span>
        <span v-if="e.isMe" class="text-[10px] text-primary-500 font-semibold shrink-0">我</span>
        <span class="ml-auto font-semibold shrink-0"
          :class="sub === 'weekMinutes' ? 'text-primary-500' : 'text-sky-500'">
          {{ sub === 'weekMinutes' ? formatMinutes(e.value) : `${e.value} 题` }}
        </span>
      </div>
    </div>
    <div v-else class="text-center text-xs text-slate-400 py-3">暂无上榜数据</div>

    <!-- 本人位置 -->
    <div v-if="board?.me" class="border-t border-slate-100 dark:border-slate-700 pt-2 flex items-center justify-between text-[11px]">
      <template v-if="data.joined && board.me.rank != null">
        <span class="text-slate-400">我的成绩：
          <span class="font-semibold text-slate-600 dark:text-slate-300">{{ sub === 'weekMinutes' ? formatMinutes(board.me.value) : `${board.me.value} 题` }}</span>
        </span>
        <span class="text-primary-500 font-semibold">
          {{ board.me.rank <= 50 ? `第 ${board.me.rank} 名` : `未进 TOP 50（第 ${board.me.rank} 名）` }}
          <template v-if="board.me.percentile != null && board.me.percentile >= 0"> · 超过 {{ board.me.percentile }}% 的同学</template>
        </span>
      </template>
      <template v-else>
        <span class="text-slate-400">我的成绩：{{ sub === 'weekMinutes' ? formatMinutes(board.me.value) : `${board.me.value} 题` }}（未参与排行）</span>
        <router-link to="/settings" class="text-primary-500 hover:underline">去设置开启进步榜 →</router-link>
      </template>
    </div>
  </div>
</template>
