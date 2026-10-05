<script setup lang="ts">
/** 听力练习面板：练习表单 + 听力历史；数据直接读写 app store */
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { studyMinutesError } from '../../utils/studyValidation'

const store = useAppStore()
const toast = useToast()
const eng = computed(() => store.english)

// ---- 听力 ----
const lisMinutes = ref(20)
const lisMaterial = ref('')
const lisMode = ref<'精听' | '泛听'>('精听')
let lastSavedAt = 0
function addListening() {
  if (Date.now() - lastSavedAt < 1200) return
  const mins = lisMinutes.value
  const error = studyMinutesError(mins)
  if (error) {
    toast(error)
    return
  }
  store.addListeningRecord(mins, lisMaterial.value || '未注明', lisMode.value)
  lastSavedAt = Date.now()
  lisMaterial.value = ''
  toast('听力记录已保存')
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
    <p v-if="!eng.listening.length" class="study-note">还没有听力记录，练习后记下材料与用时。</p>
    <div class="space-y-1.5">
      <div v-for="(l, i) in eng.listening.slice().reverse()" :key="i" class="flex items-center gap-3 text-sm">
        <span class="text-xs text-slate-400 w-20">{{ l.date }}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded" :class="'bg-surface-soft text-muted'">{{ l.mode }}</span>
        <span class="flex-1 truncate">{{ l.material }}</span>
        <span class="text-xs text-slate-400">{{ l.minutes }}分钟</span>
      </div>
    </div>
  </div>
</template>
