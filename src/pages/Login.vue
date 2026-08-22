<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Eye, EyeOff } from '@lucide/vue'
import { login, register } from '../services/auth'
import { useAppStore } from '../stores/app'

const router = useRouter()
const route = useRoute()
const store = useAppStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const errorMsg = ref('')
const loading = ref(false)

// ---- Turnstile 人机验证（仅 Web 端） ----
// __DESKTOP_BUILD__ 为编译期常量：桌面端构建时为 true，
// defineAsyncComponent 分支被 Rollup 视为死代码整体剔除，TurnstileWidget 不进入桌面产物
const isDesktop = __DESKTOP_BUILD__
const TurnstileWidget = isDesktop
  ? null
  : defineAsyncComponent(() => import('../components/TurnstileWidget.vue'))
const turnstileWidget = ref<{ reset: () => void } | null>(null)
const turnstileToken = ref('')
const turnstileKey = ref(0)          // 递增以强制重新挂载 TurnstileWidget
const turnstileError = ref(false)    // Turnstile 加载失败的独立状态

function retryTurnstile() {
  turnstileError.value = false
  turnstileToken.value = ''
  turnstileKey.value++
}

function switchMode(m: 'login' | 'register') {
  mode.value = m
  errorMsg.value = ''
  password.value = ''
  confirmPassword.value = ''
  showPassword.value = false
  showConfirmPassword.value = false
  turnstileWidget.value?.reset()
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}超时，请检查网络或禁用浏览器插件后重试`)), ms)
    )
  ])
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
  if (!isDesktop && !turnstileToken.value) {
    errorMsg.value = '请先完成人机验证'
    return
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await withTimeout(login(username.value.trim(), password.value, turnstileToken.value), 15000, '登录')
    } else {
      await withTimeout(register(username.value.trim(), password.value, turnstileToken.value), 15000, '注册')
    }
    // 登录/注册成功后从云端载入该用户的历史数据
    await withTimeout(store.hydrate(), 20000, '数据同步')
    // 回跳：登录前从某页面触发（携带 redirect）则返回原页面；否则回首页。仅允许站内路径，防 open redirect
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/')
  } catch (e: any) {
    errorMsg.value = e?.message || '操作失败，请重试'
    turnstileWidget.value?.reset()
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
        <p class="text-xs text-slate-400 mt-1">数据云端同步 · 多设备随时访问</p>
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
            <div class="relative">
              <input v-model="password" :type="showPassword ? 'text' : 'password'" class="input pr-10" maxlength="128"
                :placeholder="mode === 'register' ? '至少 6 位' : '请输入密码'"
                :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" />
              <button type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                :class="showPassword ? 'text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword"
                @click="showPassword = !showPassword">
                <Eye v-if="!showPassword" :size="16" aria-hidden="true" />
                <EyeOff v-else :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div v-if="mode === 'register'">
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block">确认密码</label>
            <div class="relative">
              <input v-model="confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" class="input pr-10" maxlength="128"
                placeholder="再次输入密码" autocomplete="new-password" />
              <button type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                :class="showConfirmPassword ? 'text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'"
                :aria-label="showConfirmPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showConfirmPassword"
                @click="showConfirmPassword = !showConfirmPassword">
                <Eye v-if="!showConfirmPassword" :size="16" aria-hidden="true" />
                <EyeOff v-else :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- Turnstile 人机验证（仅 Web 端渲染，桌面端产物不含此组件） -->
          <TurnstileWidget v-if="!isDesktop" :key="turnstileKey" ref="turnstileWidget" v-model:token="turnstileToken"
            @load-error="turnstileError = true" />

          <!-- Turnstile 加载失败（含手动重试） -->
          <div v-if="turnstileError" class="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <span>⚠️</span>人机验证组件加载失败（Cloudflare CDN 在国内可能不稳定），请尝试刷新页面或使用代理/加速器后重试
            </div>
            <button type="button"
              class="text-xs text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 underline cursor-pointer"
              @click="retryTurnstile">→ 点击重试</button>
          </div>

          <!-- 其他错误 -->
          <div v-if="errorMsg" class="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
            <span>⚠️</span>{{ errorMsg }}
          </div>

          <button type="submit" class="btn-primary w-full !py-2.5" :disabled="loading || (!isDesktop && !turnstileToken)">
            {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录' }}
          </button>
        </form>

        <!-- 访客入口：社区广场内容公开，可先浏览再决定注册 -->
        <div class="text-center mt-4">
          <button type="button" class="text-xs text-slate-400 hover:text-primary-500 transition-colors"
            @click="router.replace('/community')">先随便看看 →</button>
        </div>
      </div>

      <p class="text-center text-[11px] text-slate-400 mt-4 leading-relaxed">
        密码经 bcrypt 哈希存储，无法被还原<br />不同账号数据互相隔离
      </p>
    </div>
  </div>
</template>
