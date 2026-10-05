<script setup lang="ts">
import { computed } from 'vue'
import { Check, ArrowRight } from '@lucide/vue'
import { examDistance, recentStudyDays } from '../utils/studyOverview'
import { formatMinutes } from '../utils/date'

const props = defineProps<{
  today: string
  examDate: string
  minutes: Record<string, number>
  dailyGoal: number
}>()
defineEmits<{ select: [date: string] }>()
const days = computed(() => recentStudyDays(props.today, props.minutes))
const remaining = computed(() => examDistance(props.today, props.examDate))
const todayMinutes = computed(() => days.value[6].minutes)
const fill = computed(() => (props.dailyGoal > 0 ? Math.min(100, (todayMinutes.value / props.dailyGoal) * 100) : 0))
const deficit = computed(() => Math.max(0, props.dailyGoal - todayMinutes.value))
</script>

<template>
  <section class="study-week" aria-labelledby="study-week-title">
    <header class="study-week-heading">
      <div>
        <h3 id="study-week-title" class="study-week-title">最近七天</h3>
        <p class="study-week-goal">
          今天已学 {{ formatMinutes(todayMinutes)
          }}<span v-if="dailyGoal > 0"> / 目标 {{ formatMinutes(dailyGoal) }}</span>
        </p>
      </div>
      <p class="study-week-deficit" aria-live="polite">
        {{ dailyGoal <= 0 ? '先定一个每日目标' : deficit > 0 ? `还差 ${formatMinutes(deficit)}` : '今日时长已达标' }}
      </p>
    </header>
    <div class="study-week-days" aria-label="最近七天学习记录">
      <button
        v-for="day in days"
        :key="day.date"
        type="button"
        class="study-week-day"
        :class="{ 'is-today': day.isToday }"
        :aria-label="`${day.date}${day.isToday ? ' 今天' : ''}，${day.minutes ? '学习 ' + formatMinutes(day.minutes) : '还没有学习记录'}，查看明细`"
        @click="$emit('select', day.date)"
      >
        <span class="study-week-date">{{ day.isToday ? '今天' : day.date.slice(5).replace('-', '/') }}</span>
        <span class="study-week-mark" :class="{ 'has-record': !day.isToday && day.minutes > 0 }" aria-hidden="true">
          <span v-if="day.isToday" class="study-week-fill" :style="{ transform: `scaleY(${fill / 100})` }"></span>
          <Check v-if="!day.isToday && day.minutes > 0" :size="16" />
          <span v-else-if="!day.isToday" class="text-xs">—</span>
        </span>
        <span class="study-week-duration">{{
          day.minutes ? `${Math.round(day.minutes)}分` : day.isToday ? '未开始' : '—'
        }}</span>
      </button>
    </div>
    <div class="study-week-exam">
      <template v-if="remaining !== null">
        <div class="study-week-exam-copy">
          <span class="text-xs text-muted">考试安排</span>
          <p class="study-week-exam-status">
            {{
              remaining > 0
                ? `还有 ${remaining} 天`
                : remaining === 0
                  ? '考试就在今天'
                  : `考试日期已过 ${Math.abs(remaining)} 天`
            }}
          </p>
        </div>
        <RouterLink to="/settings" class="study-week-exam-date"
          >{{ examDate.replace(/-/g, '/') }}<span class="sr-only">，修改考试日期</span></RouterLink
        >
      </template>
      <template v-else>
        <span class="text-sm font-semibold">考试日期待定</span>
        <RouterLink to="/settings" class="study-week-exam-date">设置考试日期</RouterLink>
      </template>
    </div>
    <footer class="study-week-caption">
      <span>点选日期查看明细；今天按目标时长填涂。</span>
      <RouterLink to="/statistics" class="arrow-link"
        >查看完整记录 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
      /></RouterLink>
    </footer>
  </section>
</template>

<style scoped>
.study-week {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.study-week-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.study-week-title {
  font-size: 16px;
  font-weight: 700;
}
.study-week-goal {
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;
}
.study-week-deficit {
  color: var(--action);
  font-size: 13px;
}
.study-week-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(36px, 1fr));
  gap: 6px;
  margin: 16px 0;
}
.study-week-day {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 7px;
  min-width: 36px;
  padding: 8px 0;
  border-radius: var(--radius-control);
  color: var(--muted);
  transition: background var(--motion-fast) var(--ease-out);
}
.study-week-day:hover {
  background: var(--surface-soft);
}
.study-week-day:active {
  background: var(--action-soft);
}
.study-week-date,
.study-week-duration {
  font-size: 12px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.study-week-date {
  white-space: nowrap;
}
.study-week-duration {
  overflow-wrap: anywhere;
}
.study-week-mark {
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  width: 30px;
  height: 38px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.study-week-mark.has-record {
  border-color: var(--action);
  color: var(--on-action);
  background: var(--action);
}
.study-week-day.is-today {
  color: var(--action);
  font-weight: 700;
  background: var(--action-soft);
}
.is-today .study-week-mark {
  border-color: var(--action);
}
.study-week-fill {
  position: absolute;
  inset: 0;
  background: var(--action);
  transform-origin: bottom;
  transition: transform var(--motion-base) var(--ease-out);
}
.study-week-exam {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding-block: 12px;
  border-top: 1px solid var(--line);
}
.study-week-exam-copy {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.study-week-exam-status {
  font-size: 15px;
  font-weight: 700;
}
.study-week-exam-date {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  color: var(--action);
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.study-week-caption {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.study-week-caption .arrow-link {
  min-height: 32px;
}
@media (max-width: 639px) {
  .study-week {
    padding: 16px 12px 12px;
  }
  .study-week-days {
    gap: 1px;
    margin: 12px 0;
  }
  .study-week-heading {
    flex-direction: column;
    gap: 4px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .study-week-day,
  .study-week-fill {
    transition: none;
  }
}
</style>
