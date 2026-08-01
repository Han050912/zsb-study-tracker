<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { sessionUser, logout } from '../services/auth'
import { dbFileSize, loadUserData } from '../db/database'

const router = useRouter()
const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const user = computed(() => sessionUser.value)

function fmtTime(ts?: number) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const updatedAt = computed(() => {
  if (!user.value) return null
  return loadUserData(user.value.id)?.updatedAt ?? null
})

const dbSize = ref(formatSize(dbFileSize()))
function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

const stats = computed(() => {
  const totalPomo = Object.values(store.pomodoro.daily).reduce((s, d) => s + d.count, 0)
  return [
    { label: '学习记录', value: store.records.length, unit: '条' },
    { label: '刷题会话', value: store.problemSessions.length, unit: '次' },
    { label: '错题收录', value: store.errorQuestions.length, unit: '道' },
    { label: '习惯追踪', value: store.habits.length, unit: '个' },
    { label: '笔记', value: store.notes.length, unit: '篇' },
    { label: '资料', value: store.materials.length, unit: '份' },
    { label: '番茄钟', value: totalPomo, unit: '个' },
    { label: '每日总结', value: Object.keys(store.summaries).length, unit: '篇' }
  ]
})

function doLogout(switchAccount = false) {
  const tip = switchAccount ? '切换账号？当前数据将被保存。' : '确认退出登录？数据将被保存到本地数据库。'
  if (!window.confirm(tip)) return
  if (!store.save()) {
    toast('保存失败，请稍后再试')
    return
  }
  logout()
  store.resetState()
  router.replace('/login')
}

function exportBackup() {
  try {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `zsb-backup-${user.value?.username}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast('备份已导出')
  } catch (e) {
    console.error('导出备份失败', e)
    toast('导出失败，请重试')
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
    <h1 class="page-title">个人数据中心</h1>

    <!-- 账号卡片 -->
    <div class="card flex items-center gap-4">
      <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white flex items-center justify-center text-2xl font-bold shrink-0">
        {{ user?.username?.slice(0, 1).toUpperCase() }}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-bold text-lg truncate">{{ user?.username }}</div>
        <div class="text-xs text-slate-400 mt-0.5">
          {{ store.level.name }}学者 · {{ store.gamification.points }} 积分 · 🔥连胜 {{ store.gamification.streak }} 天
        </div>
      </div>
      <div class="flex gap-2 shrink-0">
        <button class="btn-ghost !text-xs" @click="doLogout(true)">切换账号</button>
        <button class="btn-danger !text-xs" @click="doLogout(false)">退出登录</button>
      </div>
    </div>

    <!-- 账号与数据库信息 -->
    <div class="card space-y-2.5">
      <h2 class="font-semibold text-sm">📦 本地数据库（SQLite）</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div class="flex justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
          <span class="text-slate-500 dark:text-slate-400">注册时间</span>
          <span>{{ fmtTime(user?.createdAt) }}</span>
        </div>
        <div class="flex justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
          <span class="text-slate-500 dark:text-slate-400">最近保存</span>
          <span>{{ fmtTime(updatedAt ?? undefined) }}</span>
        </div>
        <div class="flex justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
          <span class="text-slate-500 dark:text-slate-400">数据库文件大小</span>
          <span>{{ dbSize }}</span>
        </div>
        <div class="flex justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
          <span class="text-slate-500 dark:text-slate-400">我的数据大小</span>
          <span>{{ store.storageUsage }}</span>
        </div>
      </div>
      <p class="text-[11px] text-slate-400">所有数据保存在本机浏览器的 SQLite 数据库中，不上传任何服务器；清除浏览器数据会导致丢失，请定期导出备份。</p>
    </div>

    <!-- 数据统计 -->
    <div class="card">
      <h2 class="font-semibold text-sm mb-3">📊 我的数据概览</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div v-for="s in stats" :key="s.label" class="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2.5 text-center">
          <div class="text-lg font-bold text-primary-600 dark:text-primary-400">{{ s.value }}<span class="text-xs font-normal text-slate-400 ml-0.5">{{ s.unit }}</span></div>
          <div class="text-xs text-slate-500 dark:text-slate-400">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <!-- 数据操作 -->
    <div class="card flex items-center justify-between">
      <div>
        <h2 class="font-semibold text-sm">💾 数据备份</h2>
        <p class="text-xs text-slate-400 mt-0.5">导出当前账号全部数据为 JSON 文件，可在设置页导入恢复</p>
      </div>
      <button class="btn-primary !text-xs shrink-0" @click="exportBackup">导出备份</button>
    </div>
  </div>
</template>
