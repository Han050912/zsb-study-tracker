<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { today } from '../../utils/date'
import { problemTypesFor } from '../../data/problemTypes'
import Modal from '../Modal.vue'
import PostComposer from '../community/PostComposer.vue'
import { subjectLabel } from '../../utils/subject'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()
const toast = useToast()

const subject = computed(() => store.subjectMap[props.subjectId])

const subjectProblems = computed(() =>
  store.problemSessions
    .filter((p) => p.subjectId === props.subjectId)
    .slice()
    .reverse()
)

// ---- 刷题（题型模板按科目适配：数学/英语/通用，见 data/problemTypes.ts） ----
const typeDefs = computed(() => problemTypesFor(props.subjectId))
const pTypes = ref<Record<string, number>>({})
/** 单题型净化后的非负整数 */
function numType(key: string) {
  return Math.max(0, Math.floor(Number(pTypes.value[key]) || 0))
}
/** 各题型净化后的总和 */
const pTypesSum = computed(() => typeDefs.value.reduce((s, t) => s + numType(t.key), 0))
/** 题型有值时锁定「做题数量」为只读 */
const pTotalLocked = computed(() => pTypesSum.value > 0)
/** 题型分布明细（仅 > 0 的题型） */
const typeBreakdown = computed(() =>
  typeDefs.value.map((t) => ({ label: t.label, count: numType(t.key) })).filter((x) => x.count > 0)
)

// ---- 刷题确认弹窗 ----
const showConfirm = ref(false)
const confirmTotal = ref(20)
const confirmCorrect = ref(15)
const correctInvalid = ref(false)

function openConfirm() {
  const total = pTotalLocked.value ? pTypesSum.value : confirmTotal.value
  if (total <= 0) {
    toast('请填写做题数量或各题型')
    return
  }
  confirmCorrect.value = Math.min(confirmCorrect.value, total)
  showConfirm.value = true
}
/** 弹窗做题数量手动输入（仅题型全空时可用） */
function onTotalInput(e: Event) {
  const v = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))
  confirmTotal.value = v
  if (confirmCorrect.value > v) confirmCorrect.value = v
}
/** 弹窗答对数量输入：超界截断 + 变红摇晃 */
function onCorrectInput(e: Event) {
  const total = pTotalLocked.value ? pTypesSum.value : confirmTotal.value
  const v = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))
  if (v > total) {
    confirmCorrect.value = total
    correctInvalid.value = true
    window.setTimeout(() => {
      correctInvalid.value = false
    }, 500)
  } else {
    confirmCorrect.value = v
  }
}
function confirmSave() {
  const total = pTotalLocked.value ? pTypesSum.value : Math.max(0, Math.floor(Number(confirmTotal.value) || 0))
  if (total <= 0) {
    toast('请填写做题数量或各题型')
    return
  }
  const correct = Math.min(Math.max(0, Math.floor(Number(confirmCorrect.value) || 0)), total)
  const types: Record<string, number> = {}
  for (const t of typeDefs.value) {
    const v = numType(t.key)
    if (v > 0) types[t.key] = v
  }
  store.addProblemSession({ subjectId: props.subjectId, date: today(), total, correct, types })
  pTypes.value = {}
  showConfirm.value = false
  toast('刷题记录已保存')
}
const _accuracy = computed(() => {
  const t = subjectProblems.value.reduce((s, p) => s + p.total, 0)
  const c = subjectProblems.value.reduce((s, p) => s + p.correct, 0)
  return t ? Math.round((c / t) * 100) : 0
})

// ---- 分享刷题成果到社区广场 ----
const showShareComposer = ref(false)
const shareContent = ref('')
const shareTags = ref<string[]>([])
const todayProblemStats = computed(() => {
  const list = subjectProblems.value.filter((p) => p.date === today())
  const total = list.reduce((s, p) => s + p.total, 0)
  const correct = list.reduce((s, p) => s + p.correct, 0)
  return { total, correct, acc: total ? Math.round((correct / total) * 100) : 0 }
})
function openProblemShare() {
  const { total, correct, acc } = todayProblemStats.value
  if (!total) {
    toast('今天还没有刷题记录，先刷几道题吧')
    return
  }
  shareContent.value = [
    '今日刷题打卡',
    `${subjectLabel(subject.value)}：${total} 题，答对 ${correct}，正确率 ${acc}%`,
    `连续打卡 ${store.gamification.streak} 天`
  ].join('\n')
  shareTags.value = [
    '#每日打卡',
    ...(props.subjectId === 'math' ? ['#高等数学'] : props.subjectId === 'english' ? ['#英语'] : [])
  ]
  showShareComposer.value = true
}
</script>

<template>
  <div class="card space-y-3">
    <div class="section-title">记录本次刷题</div>
    <p class="text-[10px] text-slate-400">
      填写本次各题型做的题数（没做的题型可留空），点击「保存」后在弹窗中确认做题总数与答对数量
    </p>
    <div class="grid gap-2" :class="typeDefs.length > 4 ? 'grid-cols-5' : 'grid-cols-4'">
      <div v-for="t in typeDefs" :key="t.key">
        <label class="label">{{ t.label }}</label>
        <input v-model.number="pTypes[t.key]" type="number" min="0" class="input" />
      </div>
    </div>
    <button class="btn-primary w-full" @click="openConfirm">保存刷题记录</button>
  </div>
  <div class="card">
    <div class="flex items-center justify-between mb-2">
      <div class="section-title !mb-0">刷题历史</div>
      <button class="btn-ghost !py-1 !text-xs" @click="openProblemShare">分享到广场</button>
    </div>
    <div class="space-y-1.5 max-h-72 overflow-y-auto">
      <div v-for="p in subjectProblems" :key="p.id" class="flex items-center gap-2 text-sm group">
        <span class="text-xs text-slate-400 w-20">{{ p.date }}</span>
        <span class="flex-1">{{ p.correct }}/{{ p.total }} 题</span>
        <span
          class="text-xs font-semibold"
          :class="
            p.total > 0 && p.correct / p.total >= 0.8
              ? 'text-emerald-500'
              : p.total > 0 && p.correct / p.total >= 0.6
                ? 'text-amber-500'
                : 'text-red-400'
          "
        >
          {{ p.total > 0 ? Math.round((p.correct / p.total) * 100) : 0 }}%
        </span>
        <button
          class="opacity-0 group-hover:opacity-100 text-red-400 text-xs"
          @click="store.deleteProblemSession(p.id)"
        >
          删除
        </button>
      </div>
    </div>
  </div>

  <!-- 刷题确认弹窗 -->
  <Modal title="确认刷题记录" :show="showConfirm" @close="showConfirm = false">
    <div class="space-y-3">
      <div>
        <label class="label">做题数量</label>
        <input
          :value="pTotalLocked ? pTypesSum : confirmTotal"
          :disabled="pTotalLocked"
          type="number"
          min="0"
          class="input disabled:opacity-60 disabled:cursor-not-allowed"
          @input="onTotalInput"
        />
        <p v-if="pTotalLocked" class="text-[10px] text-slate-400 mt-1">已按各题型总和自动计算</p>
      </div>
      <div>
        <label class="label">答对数量</label>
        <input
          :value="confirmCorrect"
          type="number"
          min="0"
          :class="['input', correctInvalid ? '!border-red-500 shake' : '']"
          @input="onCorrectInput"
        />
        <p class="text-[10px] mt-1" :class="correctInvalid ? 'text-red-500' : 'text-slate-400'">
          答对数量不能超过做题数量
        </p>
      </div>
      <div>
        <label class="label">题型分布</label>
        <div v-if="typeBreakdown.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="t in typeBreakdown"
            :key="t.label"
            class="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
          >
            {{ t.label }} {{ t.count }}
          </span>
        </div>
        <p v-else class="text-[10px] text-slate-400">未按题型拆分，直接填写上方做题数量即可</p>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showConfirm = false">取消</button>
      <button class="btn-primary" @click="confirmSave">确认保存</button>
    </template>
  </Modal>

  <!-- 刷题成果分享 -->
  <PostComposer
    v-model:show="showShareComposer"
    type="checkin"
    ref-type="record"
    :preset-content="shareContent"
    :preset-tags="shareTags"
  />
</template>

<style scoped>
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-4px);
  }
  40% {
    transform: translateX(4px);
  }
  60% {
    transform: translateX(-3px);
  }
  80% {
    transform: translateX(3px);
  }
}
.shake {
  animation: shake 0.35s ease;
}
</style>
