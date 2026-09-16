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
    title: '欢迎使用专升本学习助手',
    desc: '记录每日学习、追踪进度、游戏化激励，陪你高效备考上岸！'
  },
  {
    icon: BookOpen,
    title: '科目模块',
    desc: '高数、英语内置考纲章节，支持记录学习、刷题、掌握度评估，还能自定义扩展科目。'
  },
  { icon: Timer, title: '番茄专注', desc: '25分钟番茄钟 + 白噪音，帮你保持专注，统计每日专注时长。' },
  { icon: Trophy, title: '成就激励', desc: '打卡得积分、升级段位、解锁徽章，连续学习天数见证你的坚持！' }
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
    <div ref="panelRef" class="card !p-8 max-w-sm w-full text-center animate-pop">
      <div class="mb-4 flex justify-center">
        <component :is="steps[step].icon" class="w-16 h-16 text-primary-500" />
      </div>
      <h2 class="text-lg font-bold mb-2">{{ steps[step].title }}</h2>
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
