<script setup lang="ts">
/** 阅读训练面板：计时训练表单 + 阅读历史；数据直接读写 app store */
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'

const store = useAppStore()
const toast = useToast()
const eng = computed(() => store.english)

// ---- 阅读 ----
const readWpm = ref(80)
const readAcc = ref(75)
function addReading() {
  // v-model.number 清空后为 ''，入 store 前净化，避免污染历史与统计
  const wpm = Math.max(0, Math.floor(Number(readWpm.value) || 0))
  const acc = Math.min(100, Math.max(0, Math.floor(Number(readAcc.value) || 0)))
  if (wpm <= 0) {
    toast('请填写有效的阅读速度')
    return
  }
  store.addReadingRecord(wpm, acc)
  toast('阅读记录已保存 +5 积分')
}
</script>

<template>
  <div class="card space-y-3">
    <div class="section-title">阅读理解计时训练</div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="en-read-wpm">阅读速度（词/分钟）</label
        ><input id="en-read-wpm" v-model.number="readWpm" type="number" min="0" class="input" />
      </div>
      <div>
        <label class="label" for="en-read-acc">正确率（%）</label
        ><input id="en-read-acc" v-model.number="readAcc" type="number" min="0" max="100" class="input" />
      </div>
    </div>
    <button class="btn-primary w-full" @click="addReading">保存阅读记录</button>
  </div>
  <div class="card">
    <div class="section-title">阅读历史</div>
    <div class="space-y-1.5">
      <div v-for="(r, i) in eng.reading.slice().reverse()" :key="i" class="flex items-center gap-3 text-sm">
        <span class="text-xs text-slate-400 w-20">{{ r.date }}</span>
        <span class="flex-1">{{ r.wpm }} 词/分钟</span>
        <span class="font-semibold" :class="r.accuracy >= 80 ? 'text-emerald-500' : 'text-amber-500'"
          >{{ r.accuracy }}%</span
        >
      </div>
    </div>
  </div>
</template>
