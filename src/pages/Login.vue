<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useRouter, useRoute } from 'vue-router'
import { Eye, EyeOff } from '@lucide/vue'
import { login, register, enterGuestMode } from '../services/auth'
import { useAppStore } from '../stores/app'
import { sanitizeInternalPath } from '../utils/path'

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
// 忘记密码说明面板：账号无邮箱/手机号绑定，无自助找回渠道，面板给出可行路径
const showForgotHint = ref(false)

// ---- Turnstile 人机验证（仅 Web 端） ----
// __DESKTOP_BUILD__ 为编译期常量：桌面端构建时为 true，
// defineAsyncComponent 分支被 Rollup 视为死代码整体剔除，TurnstileWidget 不进入桌面产物
const isDesktop = __DESKTOP_BUILD__
const TurnstileWidget = isDesktop ? null : defineAsyncComponent(() => import('../components/TurnstileWidget.vue'))
const turnstileWidget = ref<{ reset: () => void } | null>(null)
const turnstileToken = ref('')
const turnstileKey = ref(0) // 递增以强制重新挂载 TurnstileWidget
const turnstileError = ref(false) // Turnstile 加载失败的独立状态

function retryTurnstile() {
  turnstileError.value = false
  turnstileToken.value = ''
  turnstileKey.value++
}

/** 访客入口：唯一进入访客浏览模式的路径（开启后路由守卫才放行公开页） */
function enterGuest() {
  enterGuestMode()
  router.replace('/community')
}

function switchMode(m: 'login' | 'register') {
  mode.value = m
  errorMsg.value = ''
  showForgotHint.value = false
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
  // 注册密码策略与服务端 registerSchema 对齐：8-14 位且同时包含字母和数字
  if (
    mode.value === 'register' &&
    !(
      password.value.length >= 8 &&
      password.value.length <= 14 &&
      /[A-Za-z]/.test(password.value) &&
      /\d/.test(password.value)
    )
  ) {
    errorMsg.value = '密码需为 8-14 位且包含字母和数字'
    return
  }
  // 未完成验证或令牌过期（expired-callback 清空 token）时按钮仍可点，统一在提交时给出明确提示
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
    const redirect = sanitizeInternalPath(route.query.redirect) ?? '/'
    router.replace(redirect)
  } catch (e) {
    const msg = getErrorMessage(e, '操作失败，请重试')
    // 桌面端没有 Turnstile 组件，人机验证完全依赖 X-Desktop-Token：
    // 服务端仍报「缺少人机验证令牌/人机验证失败」时，说明构建期 Token 未注入或与服务端 Secret 不一致，
    // 按「完成验证」的原提示用户无法自救，映射为可操作的更新客户端提示
    if (isDesktop && msg.includes('人机验证')) {
      errorMsg.value = '客户端与服务器认证配置不一致，请更新客户端'
    } else {
      errorMsg.value = msg
    }
    turnstileWidget.value?.reset()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-4"
  >
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
          <button
            class="flex-1 py-1.5 text-sm rounded-lg transition-colors"
            :class="
              mode === 'login'
                ? 'bg-white dark:bg-slate-600 shadow font-semibold text-primary-600 dark:text-primary-400'
                : 'text-slate-500 dark:text-slate-300'
            "
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            class="flex-1 py-1.5 text-sm rounded-lg transition-colors"
            :class="
              mode === 'register'
                ? 'bg-white dark:bg-slate-600 shadow font-semibold text-primary-600 dark:text-primary-400'
                : 'text-slate-500 dark:text-slate-300'
            "
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <form class="space-y-3" @submit.prevent="submit">
          <div>
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block" for="username">用户名</label>
            <input
              v-model="username"
              id="username"
              name="username"
              class="input"
              placeholder="2~20 个字符"
              maxlength="20"
              autocomplete="username"
            />
          </div>
          <div>
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block" for="password">密码</label>
            <div class="relative">
              <input
                v-model="password"
                id="password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                class="input pr-10"
                :maxlength="mode === 'register' ? 14 : 128"
                :placeholder="mode === 'register' ? '8-14 位' : '请输入密码'"
                :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                :class="
                  showPassword
                    ? 'text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300'
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                "
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <Eye v-if="!showPassword" :size="16" aria-hidden="true" />
                <EyeOff v-else :size="16" aria-hidden="true" />
              </button>
            </div>
            <p v-if="mode === 'register'" class="text-xs text-slate-400 dark:text-slate-500 mt-1">
              8-14 位，需包含字母和数字
            </p>
          </div>
          <div v-if="mode === 'register'">
            <label class="text-xs text-slate-500 dark:text-slate-400 mb-1 block" for="confirm-password">确认密码</label>
            <div class="relative">
              <input
                v-model="confirmPassword"
                id="confirm-password"
                name="confirm-password"
                :type="showConfirmPassword ? 'text' : 'password'"
                class="input pr-10"
                maxlength="14"
                placeholder="再次输入密码"
                autocomplete="new-password"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                :class="
                  showConfirmPassword
                    ? 'text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300'
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                "
                :aria-label="showConfirmPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showConfirmPassword"
                @click="showConfirmPassword = !showConfirmPassword"
              >
                <Eye v-if="!showConfirmPassword" :size="16" aria-hidden="true" />
                <EyeOff v-else :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- Turnstile 人机验证（仅 Web 端渲染，桌面端产物不含此组件） -->
          <TurnstileWidget
            v-if="!isDesktop"
            :key="turnstileKey"
            ref="turnstileWidget"
            v-model:token="turnstileToken"
            @load-error="turnstileError = true"
          />

          <!-- Turnstile 加载失败（含手动重试） -->
          <div
            v-if="turnstileError"
            class="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 space-y-1.5"
          >
            <div class="flex items-center gap-2">
              <span></span>人机验证组件加载失败（Cloudflare CDN
              在国内可能不稳定），请尝试刷新页面或使用代理/加速器后重试
            </div>
            <button
              type="button"
              class="text-xs text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 underline cursor-pointer"
              @click="retryTurnstile"
            >
              → 点击重试
            </button>
          </div>

          <!-- 其他错误 -->
          <div
            v-if="errorMsg"
            class="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2"
          >
            <span></span>{{ errorMsg }}
          </div>

          <button type="submit" class="btn-primary w-full !py-2.5" :disabled="loading">
            {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录' }}
          </button>
        </form>

        <!-- 忘记密码：账号未绑定邮箱/手机号，无自助找回渠道，此处给出可行的处理路径 -->
        <div v-if="mode === 'login'" class="mt-4 text-center">
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-primary-500 transition-colors"
            @click="showForgotHint = !showForgotHint"
          >
            忘记密码？
          </button>
          <div
            v-if="showForgotHint"
            class="mt-2 text-left space-y-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2.5 leading-relaxed"
          >
            <p>账号仅使用「用户名 + 密码」，未绑定邮箱或手机号，因此无法自助找回密码。</p>
            <p>1. 还有其它设备处于登录状态：在「个人中心 → 账号安全」中修改密码。</p>
            <p>2. 所有设备都已无法登录：请提交 Issue 说明用户名与注册时间，由管理员核实后处理。</p>
            <a
              href="https://github.com/Han050912/zsb-study-tracker/issues/new"
              target="_blank"
              rel="noopener"
              class="inline-block text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 underline underline-offset-2"
              >提交 Issue →</a
            >
          </div>
        </div>

        <!-- 访客入口：唯一进入访客浏览模式的路径 -->
        <div class="text-center mt-4">
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-primary-500 transition-colors"
            @click="enterGuest"
          >
            先随便看看 →
          </button>
        </div>
      </div>

      <p class="text-center text-[11px] text-slate-400 mt-4 leading-relaxed">
        密码经 bcrypt 哈希存储，无法被还原，忘记后无法自助找回<br />不同账号数据互相隔离
      </p>
    </div>
  </div>
</template>
