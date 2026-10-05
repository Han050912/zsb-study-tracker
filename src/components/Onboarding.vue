<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen, GraduationCap, Timer, Trophy } from '@lucide/vue'
import { useAppStore } from '../stores/app'
import { OVERLAY_LAYER, useOverlayDismiss } from '../composables/useOverlayDismiss'

const store = useAppStore()
const step = ref(0)
const steps = [
  {
    icon: GraduationCap,
    title: '先对一下今天要做的事',
    desc: '在首页写下今天的任务，在设置里填入考试日期和每日学习目标。'
  },
  {
    icon: BookOpen,
    title: '各科复习到哪了',
    desc: '按章节记录学习和做题，给知识点做自评。不会的题，留在「我的错题」里重做。'
  },
  { icon: Timer, title: '番茄专注', desc: '选一件任务，开始一个番茄钟。完成后记录这次专注的时间。' },
  { icon: Trophy, title: '一起备考', desc: '到社区讨论真题和复习方法，也可以约一位搭子一起自习、核对计划。' }
]

function finish() {
  store.updateSettings({ onboarded: true })
}

/** 引导卡片：Esc / Tab 焦点陷阱的锚点 */
const panelRef = ref<HTMLElement | null>(null)

/**
 * 引导是「走完或跳过」的强制流程，没有「关闭」语义，故 Esc 不产生动作；
 * 但仍须占用弹层栈栈顶——否则按 Esc 会穿透到被遮罩盖住的下层弹窗，
 * 同时借此复用统一的 body 滚动锁定与焦点陷阱。
 */
useOverlayDismiss(() => {}, { show: () => true, panel: () => panelRef.value })
</script>

<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-6" :class="OVERLAY_LAYER.guide">
    <div
      ref="panelRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      class="card !p-8 max-w-sm w-full text-left"
    >
      <div class="mb-4 flex">
        <component :is="steps[step].icon" class="w-8 h-8 text-action" />
      </div>
      <h2 id="onboarding-title" class="text-lg font-bold mb-2">{{ steps[step].title }}</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{{ steps[step].desc }}</p>
      <div class="flex justify-center gap-1.5 my-5">
        <span
          v-for="(s, i) in steps"
          :key="i"
          class="w-2 h-2 rounded-full"
          :class="i === step ? 'bg-primary-500' : 'bg-slate-200 dark:bg-slate-600'"
        ></span>
      </div>
      <div class="flex gap-2 justify-center">
        <button v-if="step < steps.length - 1" class="btn-ghost" @click="finish">跳过</button>
        <button v-if="step < steps.length - 1" class="btn-primary" @click="step++">下一步</button>
        <button v-else class="btn-primary" @click="finish">开始使用</button>
      </div>
    </div>
  </div>
</template>
