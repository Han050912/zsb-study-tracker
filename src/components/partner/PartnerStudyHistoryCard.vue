<script setup lang="ts">
/** 历史开黑记录卡片：纯展示（时间/双方在线时长），数据由页面层加载后传入 */
import dayjs from 'dayjs'
import UserAvatar from '../community/UserAvatar.vue'
import { formatMinutes } from '../../utils/date'
import type { PartnerStudyRecord } from '../../types'

defineProps<{
  records: PartnerStudyRecord[]
  loading: boolean
}>()

/** Unix 秒 → MM-DD HH:mm（历史记录时间） */
function fmtDateTime(sec: number): string {
  return dayjs(sec * 1000).format('MM-DD HH:mm')
}
</script>

<template>
  <div class="card space-y-3">
    <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">历史开黑记录</div>
    <div v-if="loading" class="text-xs text-slate-400 dark:text-slate-500 text-center py-3">加载中…</div>
    <div v-else-if="!records.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
      还没有开黑记录
    </div>
    <template v-else>
      <div
        v-for="r in records"
        :key="r.id"
        class="flex items-center gap-2 py-2 border-t border-slate-100 dark:border-slate-700 first:border-t-0"
      >
        <UserAvatar :name="r.partnerName" :avatar="r.partnerAvatar" size="sm" />
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium truncate">与「{{ r.partnerName }}」开黑</div>
          <div class="text-[11px] text-slate-400">{{ fmtDateTime(r.startedAt) }} ~ {{ fmtDateTime(r.endedAt) }}</div>
        </div>
        <div class="text-right text-[11px] text-slate-500 whitespace-nowrap">
          <div>我 {{ formatMinutes(Math.floor(r.myOnlineSeconds / 60)) }}</div>
          <div>对方 {{ formatMinutes(Math.floor(r.partnerOnlineSeconds / 60)) }}</div>
        </div>
      </div>
    </template>
  </div>
</template>
