<script setup lang="ts">
import { ref, computed, defineAsyncComponent, watch } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, ArrowRight, BookOpen, ListChecks, Timer, NotebookPen } from '@lucide/vue'
import { login, register, enterGuestMode, passwordPolicyError } from '../services/auth'
import { retryBoot } from '../composables/useAppBoot'

const router = useRouter()

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
const registrationPasswordError = computed(() =>
  mode.value === 'register' && password.value ? passwordPolicyError(password.value) : null
)
watch(
  [username, password, confirmPassword],
  () => {
    errorMsg.value = ''
  },
  { flush: 'sync' }
)

// ---- Turnstile 人机验证（仅 Web 端） ----
// __DESKTOP_BUILD__ 为编译期常量：桌面端构建时为 true，
// defineAsyncComponent 分支被 Rollup 视为死代码整体剔除，TurnstileWidget 不进入桌面产物
const isDesktop = __DESKTOP_BUILD__
const TurnstileWidget = isDesktop ? null : defineAsyncComponent(() => import('../components/TurnstileWidget.vue'))
const turnstileWidget = ref<{ reset: () => void } | null>(null)
const turnstileToken = ref('')
const turnstileKey = ref(0) // 递增以强制重新挂载 TurnstileWidget
const turnstileError = ref(false) // Turnstile 加载失败的独立状态
watch(turnstileToken, (token) => {
  if (!token) return
  turnstileError.value = false
  if (errorMsg.value === '请先完成人机验证') errorMsg.value = ''
})

function retryTurnstile() {
  turnstileError.value = false
  turnstileToken.value = ''
  turnstileKey.value++
}

/** 访客入口：唯一进入访客浏览模式的路径（开启后路由守卫才放行公开页） */
function enterGuest() {
  if (loading.value) return
  enterGuestMode()
  router.replace('/community')
}

function switchMode(m: 'login' | 'register') {
  if (loading.value) return
  mode.value = m
  errorMsg.value = ''
  showForgotHint.value = false
  password.value = ''
  confirmPassword.value = ''
  showPassword.value = false
  showConfirmPassword.value = false
  turnstileWidget.value?.reset()
}

async function submit() {
  if (loading.value) return
  errorMsg.value = ''
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请输入用户名和密码'
    return
  }
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的密码不一致'
    return
  }
  if (registrationPasswordError.value) {
    errorMsg.value = registrationPasswordError.value
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
      await login(username.value.trim(), password.value, turnstileToken.value)
    } else {
      await register(username.value.trim(), password.value, turnstileToken.value)
    }
    // 登录/注册成功后从云端载入该用户的历史数据
    await retryBoot.value?.()
  } catch (e) {
    const msg = getErrorMessage(e, mode.value === 'login' ? '登录未完成，请重试' : '注册未完成，请重试')
    // 桌面端没有 Turnstile 组件，人机验证完全依赖 X-Desktop-Token：
    // 服务端仍报「缺少人机验证令牌/人机验证失败」时，说明构建期 Token 未注入或与服务端 Secret 不一致，
    // 按「完成验证」的原提示用户无法自救，映射为可操作的更新客户端提示
    if (isDesktop && msg.includes('人机验证')) {
      errorMsg.value = '客户端与服务器认证配置不一致，请更新客户端'
    } else {
      errorMsg.value = msg
    }
    // 服务端先验证 Turnstile；即使密码错误，令牌也已消耗，重试必须获取新令牌。
    turnstileWidget.value?.reset()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-layout">
      <section class="login-intro" aria-labelledby="login-intro-title">
        <p class="login-brand"><BookOpen :size="24" aria-hidden="true" />专升本助手</p>
        <h1 id="login-intro-title">把今天要学的事，安排清楚。</h1>
        <p class="login-intro-description">从今天的任务开始，专注复习，再回看每天的学习记录。</p>
        <ul class="login-workflow" aria-label="学习工作台功能">
          <li>
            <ListChecks :size="21" aria-hidden="true" />
            <div>
              <h2>写下今天的任务</h2>
              <p>按顺序安排复习，为需要提醒的任务设置时间。</p>
            </div>
          </li>
          <li>
            <Timer :size="21" aria-hidden="true" />
            <div>
              <h2>开始一段专注</h2>
              <p>用番茄钟计时，在各科页面记录学习时长。</p>
            </div>
          </li>
          <li>
            <NotebookPen :size="21" aria-hidden="true" />
            <div>
              <h2>回看复习进度</h2>
              <p>整理错题与笔记，查看各科自评和学习记录。</p>
            </div>
          </li>
        </ul>
        <p class="login-account-note">不同账号的学习记录独立保存。</p>
      </section>

      <section class="login-form-panel" aria-labelledby="login-form-title">
        <header class="login-form-heading">
          <h2 id="login-form-title">{{ mode === 'login' ? '继续今天的学习' : '创建学习账号' }}</h2>
          <p>{{ mode === 'login' ? '登录后，接着完成你的复习计划。' : '使用用户名和密码，保存自己的学习记录。' }}</p>
        </header>
        <div class="login-tabs" aria-label="选择登录或注册">
          <button
            type="button"
            :class="{ 'is-selected': mode === 'login' }"
            :aria-pressed="mode === 'login'"
            :disabled="loading"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            :class="{ 'is-selected': mode === 'register' }"
            :aria-pressed="mode === 'register'"
            :disabled="loading"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <form class="login-form" :aria-busy="loading" @submit.prevent="submit">
          <div>
            <label class="login-label" for="username">用户名</label>
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
            <label class="login-label" for="password">密码</label>
            <div class="relative">
              <input
                v-model="password"
                id="password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                class="input pr-12"
                :maxlength="mode === 'register' ? 14 : 128"
                :placeholder="mode === 'register' ? '8-14 位' : '请输入密码'"
                :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
                :aria-describedby="mode === 'register' ? 'password-hint' : undefined"
                :aria-invalid="mode === 'register' ? !!registrationPasswordError : undefined"
              />
              <button
                type="button"
                class="icon-button login-password-toggle"
                :class="{ 'is-visible': showPassword }"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <Eye v-if="!showPassword" :size="16" aria-hidden="true" />
                <EyeOff v-else :size="16" aria-hidden="true" />
              </button>
            </div>
            <p
              v-if="mode === 'register'"
              id="password-hint"
              class="login-field-hint"
              :class="{ 'is-invalid': registrationPasswordError, 'is-valid': password && !registrationPasswordError }"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {{ password ? registrationPasswordError || '密码格式符合要求' : '8-14 位，需包含字母和数字' }}
            </p>
          </div>
          <div v-if="mode === 'register'">
            <label class="login-label" for="confirm-password">确认密码</label>
            <div class="relative">
              <input
                v-model="confirmPassword"
                id="confirm-password"
                name="confirm-password"
                :type="showConfirmPassword ? 'text' : 'password'"
                class="input pr-12"
                maxlength="14"
                placeholder="再次输入密码"
                autocomplete="new-password"
              />
              <button
                type="button"
                class="icon-button login-password-toggle"
                :class="{ 'is-visible': showConfirmPassword }"
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
          <div v-if="turnstileError" class="login-error" role="alert">
            <p>人机验证未能加载。请检查网络或刷新页面，再重试验证。</p>
            <button type="button" class="login-retry" @click="retryTurnstile">
              重新加载验证 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </div>

          <!-- 其他错误 -->
          <p :class="errorMsg ? 'login-error' : 'sr-only'" role="alert" aria-atomic="true">{{ errorMsg }}</p>

          <button type="submit" class="btn-primary login-submit" :disabled="loading">
            {{
              loading ? (mode === 'login' ? '正在登录…' : '正在创建账号…') : mode === 'login' ? '登录' : '注册并登录'
            }}
          </button>
        </form>

        <!-- 忘记密码：账号未绑定邮箱/手机号，无自助找回渠道，此处给出可行的处理路径 -->
        <div v-if="mode === 'login'" class="login-recovery">
          <button
            type="button"
            class="login-forgot-button"
            :aria-expanded="showForgotHint"
            aria-controls="login-recovery-hint"
            @click="showForgotHint = !showForgotHint"
          >
            忘记密码？
          </button>
          <div v-if="showForgotHint" id="login-recovery-hint" class="login-recovery-hint">
            <p>账号仅使用「用户名 + 密码」，未绑定邮箱或手机号，因此无法自助找回密码。</p>
            <p>1. 还有其它设备处于登录状态：在「我的账号 → 账号安全」中修改密码。</p>
            <p>2. 所有设备都已无法登录：请提交 Issue 说明用户名与注册时间，由管理员核实后处理。</p>
            <a
              href="https://github.com/Han050912/zsb-study-tracker/issues/new"
              target="_blank"
              rel="noopener"
              class="study-link arrow-link"
              >提交 Issue <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
            /></a>
          </div>
        </div>

        <!-- 访客入口：唯一进入访客浏览模式的路径 -->
        <footer class="login-form-footer">
          <button type="button" class="login-guest" :disabled="loading" @click="enterGuest">
            先浏览升本讨论 <ArrowRight :size="16" aria-hidden="true" />
          </button>
          <p>请妥善保存密码，目前不支持自助找回。</p>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 48px 32px;
  background: var(--paper);
}
.login-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(366px, 1fr);
  align-items: center;
  gap: 72px;
  width: 100%;
  max-width: 1024px;
}
.login-intro {
  min-width: 0;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
  color: var(--action);
  font-size: 21px;
  font-weight: 700;
}
.login-intro h1 {
  max-width: 16em;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.5;
  text-wrap: balance;
}
.login-intro-description {
  max-width: 28em;
  margin-top: 12px;
  color: var(--muted);
  line-height: 1.8;
}
.login-workflow {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 36px;
}
.login-workflow li {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.login-workflow svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--action);
}
.login-workflow h2 {
  font-size: 15px;
  font-weight: 700;
}
.login-workflow p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;
}
.login-account-note {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}
.login-form-panel {
  min-width: 0;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.login-form-heading h2 {
  font-size: 24px;
  line-height: 1.45;
  font-weight: 700;
}
.login-form-heading p {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
}
.login-tabs {
  display: flex;
  gap: 4px;
  margin: 24px 0 20px;
  padding: 4px;
  border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.login-tabs button {
  flex: 1;
  min-height: 40px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 14px;
  transition: background var(--motion-fast) var(--ease-out);
}
.login-tabs button.is-selected {
  color: var(--action);
  background: var(--surface);
  font-weight: 700;
}
.login-tabs button:hover:not(.is-selected) {
  color: var(--action);
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.login-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 700;
}
.login-password-toggle {
  position: absolute;
  top: 50%;
  right: 2px;
  transform: translateY(-50%);
  color: var(--muted);
}
.login-password-toggle.is-visible,
.login-password-toggle:hover {
  color: var(--action);
}
.login-field-hint {
  margin-top: 6px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}
.login-field-hint.is-invalid {
  color: var(--correction);
}
.login-field-hint.is-valid {
  color: var(--action);
}
.login-error {
  padding: 12px;
  border-radius: var(--radius-control);
  color: var(--correction);
  background: var(--correction-soft);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.login-retry,
.login-guest {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border-radius: var(--radius-control);
  color: var(--action);
  font-size: 13px;
}
.login-retry {
  margin-top: 4px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.login-submit {
  width: 100%;
  min-height: 46px;
  margin-top: 4px;
}
.login-recovery {
  margin-top: 8px;
}
.login-forgot-button {
  min-height: 44px;
  color: var(--muted);
  font-size: 13px;
}
.login-forgot-button:hover {
  color: var(--action);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.login-recovery-hint {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-control);
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.login-form-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  text-align: center;
}
.login-guest {
  width: 100%;
}
.login-guest:hover {
  background: var(--action-soft);
}
.login-form-footer p {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 900px) {
  .login-layout {
    grid-template-columns: minmax(0, 1.1fr) minmax(350px, 1fr);
    gap: 32px;
  }
  .login-intro h1 {
    font-size: 24px;
  }
  .login-form-panel {
    padding: 24px;
  }
}
@media (max-width: 767px) {
  .login-page {
    align-items: flex-start;
    padding: 32px 16px;
  }
  .login-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    max-width: 440px;
  }
  .login-brand {
    margin-bottom: 16px;
    font-size: 20px;
  }
  .login-intro h1 {
    font-size: 21px;
  }
  .login-intro-description {
    margin-top: 8px;
    font-size: 13px;
  }
  .login-workflow,
  .login-account-note {
    display: none;
  }
  .login-form-panel {
    padding: 20px;
  }
  .login-form-heading h2 {
    font-size: 21px;
  }
}
@media (max-width: 373px) {
  /* 保留标准验证组件的 300px 宽度，窄屏只收紧表单两侧留白。 */
  .login-page {
    padding-inline: clamp(0px, calc((100% - 318px) / 2), 16px);
  }
  .login-form-panel {
    padding-inline: clamp(0px, calc((100% - 302px) / 2), 20px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-tabs button {
    transition: none;
  }
}
</style>
