<script setup lang="ts">
/** 搭子周报对比弹窗：本周学习时长/连续打卡/刷题数/番茄专注 四项指标「我 vs 搭子」；
 *  对方未开放学习数据共享（shared=false）时仅展示提示 */
import { onMounted, ref } from 'vue'
import { communityApi } from '../../api/community'
import Modal from '../Modal.vue'
import { formatMinutes } from '../../utils/date'
import type { PartnerWeeklyReport, PartnerWeeklyStats } from '../../types'

const props = defineProps<{ partnerId: string; partnerName: string }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const loadError = ref(false)
const report = ref<PartnerWeeklyReport | null>(null)

const METRICS: { key: keyof PartnerWeeklyStats; label: string; fmt: (v: number) => string }[] = [
  { key: 'minutes', label: '本周学习时长', fmt: formatMinutes },
  { key: 'streak', label: '连续打卡', fmt: v => `${v}天` },
  { key: 'problems', label: '刷题数', fmt: v => `${v}题` },
  { key: 'pomodoroMinutes', label: '番茄专注', fmt: formatMinutes }
]

onMounted(async () => {
  try {
    report.value = await communityApi.partnerWeeklyReport(props.partnerId)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <Modal :title="`周报对比 · ${partnerName}`" :show="true" @close="emit('close')">
    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="loadError" class="text-center text-xs text-slate-400 py-10">加载失败，请稍后重试</div>
    <div v-else-if="report && !report.shared" class="text-center text-xs text-slate-400 py-10">对方未开放学习数据共享</div>
    <div v-else-if="report?.mine && report?.theirs" class="space-y-2">
      <div v-if="report.weekStart && report.weekEnd" class="text-center text-[10px] text-slate-400">
        统计周期：{{ report.weekStart }} ~ {{ report.weekEnd }}
      </div>
      <div class="grid grid-cols-3 text-xs font-semibold text-slate-500 dark:text-slate-300 px-1">
        <span>指标</span><span class="text-center">我</span><span class="text-center">{{ report.partnerName || partnerName }}</span>
      </div>
      <div v-for="m in METRICS" :key="m.key"
        class="grid grid-cols-3 items-center text-xs px-1 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
        <span class="text-slate-500 dark:text-slate-300">{{ m.label }}</span>
        <span class="text-center font-bold text-primary-500">{{ m.fmt(report.mine[m.key]) }}</span>
        <span class="text-center font-bold">{{ m.fmt(report.theirs[m.key]) }}</span>
      </div>
    </div>
  </Modal>
</template>
