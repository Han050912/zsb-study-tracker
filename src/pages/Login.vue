<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, register } from '../services/auth'
import { useAppStore } from '../stores/app'

const router = useRouter()
const store = useAppStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

function switchMode(m: 'login' | 'register') {
  mode.value = m
  errorMsg.value = ''
  password.value = ''
  confirmPassword.value = ''
}

async function submit() {
  errorMsg.value = ''
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请输入用户名和密码'
    return
  }
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await login(username.value.trim(), password.value)
    } else {
      await register(username.value.trim(), password.value)
    }
    // 登录/注册成功后载入该用户的历史数据（自动解密 + 旧版数据迁移）
    await store.hydrate()
    router.replace('/')
  } catch (e: any) {
    errorMsg.value = e?.message || '操作失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-6">
        <div class="text-4xl mb-2">🎓</div>
        <h1 class="text-xl font-bold text-slate-800 dark:text-slate-100">专升本学习助手</h1>
        <p class="text-xs text-slate-400 mt-1">数据保存在本地 SQLite 数据库 · 仅存储于此设备</p>
      </div>

      <div class="card !p-6">
        <!-- 选项卡 -->
        <div class="flex rounded-xl bg-slate-100 dark:bg-slate-700 p-1 mb-5">
          <button class="flex-1 py-1.5 text-sm rounded-lg transition-colors"
            :class="mode === 'login' ? 'bg-white dark:bg-slate-600 shadow font-semibold text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-300'"
            @click="switchMode('login')">登录</button>
          <button class="flex-1 py-1.5 text-sm rounded-lg transition-colors"
            :class="mode === 'register' ? 'bg-white dark:bg-slate-600 shadow font-semibold text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-300'"
            @click="switchMode('register')">注册</button>
        </div>

        <form class="space-y-3" @submit.prevent="submit">
          <div>
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block">用户名</label>
            <input v-model="username" class="input" placeholder="2~20 个字符" maxlength="20" autocomplete="username" />
          </div>
          <div>
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block">密码</label>
            <input v-model="password" type="password" class="input" maxlength="128"
              :placeholder="mode === 'register' ? '至少 6 位' : '请输入密码'"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" />
          </div>
          <div v-if="mode === 'register'">
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block">确认密码</label>
            <input v-model="confirmPassword" type="password" class="input" maxlength="128" placeholder="再次输入密码" autocomplete="new-password" />
          </div>

          <!-- 错误提示 -->
          <div v-if="errorMsg" class="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
            <span>⚠️</span>{{ errorMsg }}
          </div>

          <button type="submit" class="btn-primary w-full !py-2.5" :disabled="loading">
            {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录' }}
          </button>
        </form>
      </div>

      <p class="text-center text-[11px] text-slate-400 mt-4 leading-relaxed">
        密码经 PBKDF2 加密存储，无法被还原<br />同一设备可注册多个账号，数据互相隔离
      </p>
    </div>
  </div>
</template>
