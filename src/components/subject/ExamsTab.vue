<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { today } from '../../utils/date'
import { useChart, chartTextColor } from '../../composables/useChart'
import ChartFallback from '../ChartFallback.vue'
import Modal from '../Modal.vue'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()
const toast = useToast()

const subject = computed(() => store.subjectMap[props.subjectId])

const subjectExams = computed(() =>
  store.exams
    .filter((e) => e.subjectId === props.subjectId)
    .slice()
    .reverse()
)

// ---- 真题 ----
const showExamModal = ref(false)
const examForm = ref({ title: '', score: 100, totalScore: 150, minutes: 120 })
function addExam() {
  if (!examForm.value.title) return
  store.addExam({ subjectId: props.subjectId, date: today(), ...examForm.value })
  showExamModal.value = false
  examForm.value = { title: '', score: 100, totalScore: 150, minutes: 120 }
  toast('真题记录已保存')
}
const {
  el: examTrendEl,
  status: examTrendStatus,
  retry: retryExamTrend
} = useChart(
  () => ({
    grid: { left: 40, right: 16, top: 20, bottom: 24 },
    xAxis: {
      type: 'category',
      data: subjectExams.value
        .slice()
        .reverse()
        .map((e) => e.date),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    yAxis: { type: 'value', axisLabel: { color: chartTextColor() } },
    series: [
      {
        type: 'line',
        smooth: true,
        data: subjectExams.value
          .slice()
          .reverse()
          .map((e) => (e.totalScore > 0 ? Math.round((e.score / e.totalScore) * 100) : 0)),
        name: '得分率%',
        lineStyle: { color: subject.value?.color },
        itemStyle: { color: subject.value?.color },
        areaStyle: { opacity: 0.15 }
      }
    ],
    tooltip: { trigger: 'axis' }
  }),
  [subjectExams]
)
</script>

<template>
  <div class="card">
    <div class="flex items-center justify-between mb-2">
      <div class="section-title !mb-0">真题成绩趋势（得分率%）</div>
      <button class="btn-primary !py-1.5" @click="showExamModal = true">+ 记录真题</button>
    </div>
    <ChartFallback v-if="examTrendStatus === 'error'" class="h-52" @retry="retryExamTrend" />
    <div v-else-if="subjectExams.length" ref="examTrendEl" class="h-52"></div>
    <div v-else class="text-xs text-slate-400 text-center py-6">暂无真题记录</div>
    <div class="space-y-1.5 mt-2">
      <div v-for="e in subjectExams" :key="e.id" class="flex items-center gap-2 text-sm group">
        <span class="text-xs text-slate-400 w-20">{{ e.date }}</span>
        <span class="flex-1 truncate">{{ e.title }}</span>
        <span class="font-semibold">{{ e.score }}/{{ e.totalScore }}</span>
        <span class="text-xs text-slate-400">{{ e.minutes }}分钟</span>
        <button class="opacity-0 group-hover:opacity-100 text-red-400 text-xs" @click="store.deleteExam(e.id)">
          删除
        </button>
      </div>
    </div>
  </div>

  <!-- 真题弹窗 -->
  <Modal title="记录真题/套卷" :show="showExamModal" @close="showExamModal = false">
    <div class="space-y-3">
      <div>
        <label class="label">试卷名称</label
        ><input v-model="examForm.title" class="input" placeholder="如：2023年真题卷" />
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div>
          <label class="label">得分</label><input v-model.number="examForm.score" type="number" class="input" />
        </div>
        <div>
          <label class="label">总分</label><input v-model.number="examForm.totalScore" type="number" class="input" />
        </div>
        <div>
          <label class="label">用时(分)</label><input v-model.number="examForm.minutes" type="number" class="input" />
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showExamModal = false">取消</button>
      <button class="btn-primary" @click="addExam">保存</button>
    </template>
  </Modal>
</template>
