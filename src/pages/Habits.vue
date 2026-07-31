<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { today } from '../utils/date'
import dayjs from 'dayjs'
import Modal from '../components/Modal.vue'
import type { HabitType } from '../types'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const showModal = ref(false)
const form = ref({ name: '', type: 'checkbox' as HabitType, target: 1, bad: false })

function add() {
  if (!form.value.name.trim()) return
  store.addHabit({ ...form.value, target: form.value.type === 'checkbox' ? undefined : form.value.target })
  showModal.value = false
  form.value = { name: '', type: 'checkbox', target: 1, bad: false }
  toast('习惯已添加')
}

function record(h: any, value: number | string) {
  const hadValue = !!h.records[today()]
  store.recordHabit(h.id, today(), value)
  // 仅当天从"未完成"变为"完成"时奖励，重复操作不重复加分
  if (!h.bad && value && !hadValue) {
    store.addPoints(2, `完成习惯「${h.name}」`)
    toast('打卡成功 +2 积分')
  } else {
    toast(h.bad ? '已记录，注意自律！' : '已更新')
  }
  store.save()
}

/** 近 30 天热力 */
function heatData(h: any) {
  return Array.from({ length: 30 }, (_, i) => {
    const d = dayjs().subtract(29 - i, 'day').format('YYYY-MM-DD')
    const v = h.records[d]
    return { date: d, done: h.type === 'checkbox' ? !!v : Number(v) > 0 }
  })
}

const goodHabits = computed(() => store.habits.filter(h => !h.bad))
const badHabits = computed(() => store.habits.filter(h => h.bad))

function removeHabit(id: string) {
  if (!window.confirm('删除该习惯及其记录？')) return
  store.deleteHabit(id)
  toast('已删除')
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">✅ 习惯追踪</h1>
      <button class="btn-primary" @click="showModal = true">+ 新习惯</button>
    </div>

    <div class="grid md:grid-cols-2 gap-3">
      <div v-for="h in goodHabits" :key="h.id" class="card">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-sm">{{ h.name }}
            <span v-if="h.target" class="text-xs text-slate-400">目标 {{ h.target }}{{ h.type === 'minutes' ? '分钟' : h.type === 'count' ? '次' : '' }}</span>
          </span>
          <button class="text-xs text-red-400" @click="removeHabit(h.id)">删除</button>
        </div>
        <!-- 今日操作 -->
        <div class="mb-3">
          <button v-if="h.type === 'checkbox'" class="btn w-full"
            :class="h.records[today()] ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="record(h, h.records[today()] ? 0 : 1)">
            {{ h.records[today()] ? '✓ 今日已完成' : '点击打卡' }}
          </button>
          <div v-else-if="h.type === 'time'" class="flex gap-2">
            <input type="time" class="input" :value="(h.records[today()] as string) || ''"
              @change="record(h, ($event.target as HTMLInputElement).value)" />
          </div>
          <div v-else class="flex gap-2">
            <input type="number" min="0" class="input" :placeholder="h.type === 'minutes' ? '分钟数' : '次数'"
              :value="(h.records[today()] as number) || ''"
              @keyup.enter="record(h, Number(($event.target as HTMLInputElement).value))" />
            <button class="btn-primary shrink-0" @click="record(h, Number(($event.currentTarget as HTMLElement).previousElementSibling ? (($event.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement).value : 0))">保存</button>
          </div>
        </div>
        <!-- 30天热力 -->
        <div class="flex gap-[3px] flex-wrap">
          <div v-for="c in heatData(h)" :key="c.date" :title="c.date"
            class="w-3.5 h-3.5 rounded-sm" :class="c.done ? 'bg-emerald-400' : 'bg-slate-100 dark:bg-slate-700'"></div>
        </div>
      </div>
    </div>

    <div v-if="badHabits.length">
      <h2 class="section-title !text-base mt-2">⚠️ 坏习惯监督</h2>
      <div class="grid md:grid-cols-2 gap-3">
        <div v-for="h in badHabits" :key="h.id" class="card border-red-100 dark:border-red-900/40">
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium text-sm">🚫 {{ h.name }}</span>
            <button class="text-xs text-red-400" @click="removeHabit(h.id)">删除</button>
          </div>
          <div class="flex items-center gap-3">
            <button class="btn-danger" @click="record(h, (Number(h.records[today()]) || 0) + 1)">+1 次</button>
            <span class="text-sm">今日：<b class="text-red-500">{{ h.records[today()] || 0 }}</b> 次</span>
            <button v-if="Number(h.records[today()]) > 0" class="text-xs text-slate-400" @click="record(h, Number(h.records[today()]) - 1)">撤销</button>
          </div>
        </div>
      </div>
    </div>

    <Modal title="新建习惯" :show="showModal" @close="showModal = false">
      <div class="space-y-3">
        <div><label class="label">习惯名称</label><input v-model="form.name" class="input" placeholder="如：每日复盘" /></div>
        <div>
          <label class="label">量化方式</label>
          <div class="grid grid-cols-4 gap-1.5">
            <button v-for="t in [{ k: 'checkbox', l: '勾选' }, { k: 'minutes', l: '时长' }, { k: 'count', l: '次数' }, { k: 'time', l: '时刻' }]"
              :key="t.k" class="btn !text-xs" :class="form.type === t.k ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
              @click="form.type = t.k as HabitType">{{ t.l }}</button>
          </div>
        </div>
        <div v-if="form.type !== 'checkbox'"><label class="label">每日目标</label><input v-model.number="form.target" type="number" min="1" class="input" /></div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="form.bad" class="accent-red-500" /> 这是坏习惯（监督模式）</label>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="showModal = false">取消</button>
        <button class="btn-primary" @click="add">创建</button>
      </template>
    </Modal>
  </div>
</template>
