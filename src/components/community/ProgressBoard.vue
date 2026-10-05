<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import AsyncState from '../../shared/components/AsyncState.vue'
import EmptyState from '../../shared/components/EmptyState.vue'
/**
 * 学习进步榜（P1）：本周学习时长 / 本月刷题数 TOP 50，仅「参与学习进步榜」用户上榜。
 * 不展示末位排名；本人上榜高亮，未上榜显示排名与百分位；未参与显示开通引导。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { postsApi } from '../../api/community/posts'
import { formatMinutes } from '../../utils/date'
import { levelOf } from '../../data/defaults'
import type { ProgressBoardData } from '../../types'
import UserAvatar from './UserAvatar.vue'

const data = ref<ProgressBoardData | null>(null)
const sub = ref<'weekMinutes' | 'monthProblems'>('weekMinutes')

const loading = ref(true)
const loadError = ref('')
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await postsApi.progressBoard()
  } catch {
    loadError.value = '榜单未能加载，请检查网络后重试'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const board = computed(() => (data.value ? data.value[sub.value] : null))
const router = useRouter()
const medal = (i: number) => i + 1
/** 跳转用户成长主页 */
function goProfile(userId: string) {
  router.push(`/profile/${userId}`)
}
</script>

<template>
  <AsyncState v-if="loading || loadError" :loading="loading" :error="loadError" @retry="load" />
  <div v-else-if="data" class="space-y-3">
    <!-- 子榜切换 -->
    <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs w-fit">
      <button
        class="px-3 py-1.5 rounded-md transition-colors"
        :class="
          sub === 'weekMinutes'
            ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm'
            : 'text-slate-500 dark:text-slate-400'
        "
        @click="sub = 'weekMinutes'"
      >
        本周时长
      </button>
      <button
        class="px-3 py-1.5 rounded-md transition-colors"
        :class="
          sub === 'monthProblems'
            ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm'
            : 'text-slate-500 dark:text-slate-400'
        "
        @click="sub = 'monthProblems'"
      >
        本月刷题
      </button>
    </div>

    <!-- 榜单 -->
    <div v-if="board?.list.length" class="space-y-1.5">
      <div
        v-for="(e, i) in board.list"
        :key="e.userId"
        class="flex flex-wrap items-center gap-2 text-xs rounded-lg px-1.5 py-1"
        :class="e.isMe ? 'bg-primary-50 dark:bg-primary-900/30' : ''"
      >
        <span class="w-6 text-center shrink-0">{{ medal(i) }}</span>
        <button type="button" class="flex items-center gap-2 cursor-pointer group" @click="goProfile(e.userId)">
          <UserAvatar :name="e.userName" :avatar="e.userAvatar" size="sm" />
          <span
            class="font-medium truncate max-w-[7rem] group-hover:text-action"
            :class="e.isMe ? 'text-action dark:text-action' : ''"
            >{{ e.userName }}</span
          >
        </button>
        <span
          v-if="e.verified"
          class="w-3.5 h-3.5 rounded-full bg-action text-on-action text-[9px] flex items-center justify-center shrink-0"
          title="认证专家"
          >✓</span
        >
        <span class="text-xs px-1 rounded-full shrink-0" :style="{ color: 'var(--muted)' }">
          {{ levelOf(e.totalPoints).name }}
        </span>
        <span v-if="e.isMe" class="text-xs text-action font-semibold shrink-0">我</span>
        <span class="ml-auto font-semibold shrink-0" :class="sub === 'weekMinutes' ? 'text-action' : 'text-action'">
          {{ sub === 'weekMinutes' ? formatMinutes(e.value) : `${e.value} 题` }}
        </span>
      </div>
    </div>
    <EmptyState v-else title="这一期还没有上榜记录。参与后，学习记录会计入榜单。" />

    <!-- 本人位置 -->
    <div
      v-if="board?.me"
      class="border-t border-slate-100 dark:border-slate-700 pt-2 flex items-center justify-between text-xs"
    >
      <template v-if="data.joined && board.me.rank != null">
        <span class="text-slate-400"
          >我的记录：
          <span class="font-semibold text-slate-600 dark:text-slate-300">{{
            sub === 'weekMinutes' ? formatMinutes(board.me.value) : `${board.me.value} 题`
          }}</span>
        </span>
        <span class="text-action font-semibold">
          {{ board.me.rank <= 50 ? `第 ${board.me.rank} 名` : `前 50 名之外（第 ${board.me.rank} 名）` }}
          <template v-if="board.me.percentile != null && board.me.percentile >= 0">
            · 超过 {{ board.me.percentile }}% 的同学</template
          >
        </span>
      </template>
      <template v-else>
        <span class="text-slate-400"
          >我的记录：{{
            sub === 'weekMinutes' ? formatMinutes(board.me.value) : `${board.me.value} 题`
          }}（未参与排行）</span
        >
        <router-link to="/settings" class="text-action hover:underline arrow-link"
          >去设置开启进步榜 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
        /></router-link>
      </template>
    </div>
  </div>
</template>
