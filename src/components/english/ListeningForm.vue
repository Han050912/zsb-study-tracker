<script setup lang="ts">
/** 听力练习面板：练习表单 + 听力历史；数据直接读写 app store */
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'

const store = useAppStore()
const toast = useToast()
const eng = computed(() => store.english)

// ---- 听力 ----
const lisMinutes = ref(20)
const lisMaterial = ref('')
const lisMode = ref<'精听' | '泛听'>('精听')
function addListening() {
  // v-model.number 清空后为 ''，入 store 前净化
  const mins = Math.max(0, Math.floor(Number(lisMinutes.value) || 0))
  if (mins <= 0) {
    toast('请填写有效的听力时长')
    return
  }
  store.addListeningRecord(mins, lisMaterial.value || '未注明', lisMode.value)
  lisMaterial.value = ''
  toast(`听力记录已保存 +${Math.round(mins / 10)} 积分`)
}
</script>

<template>
  <div class="card space-y-3">
    <div class="section-title">听力练习</div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="en-lis-minutes">时长（分钟）</label
        ><input id="en-lis-minutes" v-model.number="lisMinutes" type="number" min="1" class="input" />
      </div>
      <div>
        <label class="label" for="en-lis-mode">模式</label>
        <select id="en-lis-mode" v-model="lisMode" class="input">
          <option>精听</option>
          <option>泛听</option>
        </select>
      </div>
    </div>
    <div>
      <label class="label" for="en-lis-material">材料</label
      ><input id="en-lis-material" v-model="lisMaterial" class="input" placeholder="如：历年真题听力 Section A" />
    </div>
    <button class="btn-primary w-full" @click="addListening">保存听力记录</button>
  </div>
  <div class="card">
    <div class="section-title">听力历史</div>
    <div class="space-y-1.5">
      <div v-for="(l, i) in eng.listening.slice().reverse()" :key="i" class="flex items-center gap-3 text-sm">
        <span class="text-xs text-slate-400 w-20">{{ l.date }}</span>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded"
          :class="l.mode === '精听' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'"
          >{{ l.mode }}</span
        >
        <span class="flex-1 truncate">{{ l.material }}</span>
        <span class="text-xs text-slate-400">{{ l.minutes }}分钟</span>
      </div>
    </div>
  </div>
</template>
