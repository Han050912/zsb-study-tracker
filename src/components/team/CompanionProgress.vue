<script setup lang="ts">
import { computed } from 'vue'
import type { TeamChallenge } from '../../types'
import { TYPE_LABEL, TYPE_UNIT, STATUS_LABEL, challengeStatus } from '../../utils/teamChallengeMeta'
const props = defineProps<{ challenge: TeamChallenge; memberCount: number; showMine?: boolean }>()
const progress = computed(() =>
  Math.min(100, Math.max(0, (props.challenge.myProgress / Math.max(1, props.challenge.target)) * 100))
)
const teamProgress = computed(() =>
  Math.min(100, (props.challenge.completedCount / Math.max(1, props.memberCount)) * 100)
)
</script>
<template>
  <section class="space-y-3" :aria-label="`${TYPE_LABEL[challenge.type]}同行进度`">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-semibold">
        {{ TYPE_LABEL[challenge.type] }} <span class="training-number">{{ challenge.target }}</span>
        {{ TYPE_UNIT[challenge.type] }}
      </h3>
      <span class="text-xs text-slate-500">{{ STATUS_LABEL[challengeStatus(challenge)] }}</span>
    </div>
    <div class="progress-track space-y-4">
      <div v-if="showMine">
        <div class="flex justify-between text-xs mb-2">
          <span>{{ challenge.myCompleted ? '我已达标' : '我的进度' }}</span
          ><span class="training-number">{{ challenge.myProgress }} / {{ challenge.target }}</span>
        </div>
        <div
          role="progressbar"
          aria-label="我的挑战进度"
          :aria-valuenow="Math.round(progress)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          class="h-2 rounded-full bg-slate-100 dark:bg-slate-700"
        >
          <div class="h-full rounded-full bg-[#2457E6]" :style="{ width: progress + '%' }"></div>
        </div>
      </div>
      <div>
        <div class="flex justify-between text-xs mb-2">
          <span>一起达标</span
          ><span class="training-number">{{ challenge.completedCount }} / {{ memberCount }} 人</span>
        </div>
        <div
          role="progressbar"
          aria-label="小队达标比例"
          :aria-valuenow="Math.round(teamProgress)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          class="h-2 rounded-full bg-slate-100 dark:bg-slate-700"
        >
          <div class="h-full rounded-full bg-[#2FBF9B]" :style="{ width: teamProgress + '%' }"></div>
        </div>
      </div>
    </div>
    <p class="text-xs text-slate-500 dark:text-slate-400 training-number">
      {{ challenge.startDate }} — {{ challenge.endDate }} · 截止
    </p>
  </section>
</template>
