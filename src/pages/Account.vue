<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useToast } from '../composables/useToast'
import { ChevronDown } from '@lucide/vue'
import { useAppStore } from '../stores/app'
import { changePassword, passwordPolicyError, sessionUser } from '../services/auth'
import { getErrorMessage } from '../utils/error'
import { usersApi } from '../api/community/users'
import type { CommunityUserProfile } from '../types'
import Modal from '../components/Modal.vue'
import ProfileHeader from '../components/profile/ProfileHeader.vue'
import SocialStatsBar from '../components/profile/SocialStatsBar.vue'
import UserWorksTabs from '../components/profile/UserWorksTabs.vue'
import EditProfileModal from '../components/profile/EditProfileModal.vue'

const store = useAppStore()
const toast = useToast()

const user = computed(() => sessionUser.value)
const myId = computed(() => sessionUser.value?.id ?? '')

const profile = ref<CommunityUserProfile | null>(null)
const profileLoading = ref(true)
const profileError = ref(false)
const worksTab = ref<'posts' | 'likes'>('posts')
const showEdit = ref(false)
const showDataCenter = ref(false)

async function reloadProfile() {
  if (!myId.value) return
  profileLoading.value = true
  profileError.value = false
  try {
    profile.value = await usersApi.profile(myId.value)
  } catch {
    profileError.value = true
  } finally {
    profileLoading.value = false
  }
}

function fmtTime(ts?: number) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const myDataSize = ref('—')

onMounted(async () => {
  reloadProfile()
  try {
    myDataSize.value = await store.storageUsageText()
  } catch (e) {
    console.error('读取数据信息失败', e)
  }
})

// ---- 账号安全：修改密码 ----
const showSecurity = ref(false)
const showPasswordModal = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showPw = ref(false)
const pwError = ref('')
const pwSaving = ref(false)

// ---- Turnstile 人机验证（仅 Web 端；桌面端走 X-Desktop-Token，与登录/注册同口径）----
// __DESKTOP_BUILD__ 为编译期常量：桌面端构建时 TurnstileWidget 分支被整体 tree-shake
const isDesktop = __DESKTOP_BUILD__
const TurnstileWidget = isDesktop ? null : defineAsyncComponent(() => import('../components/TurnstileWidget.vue'))
const turnstileWidget = ref<{ reset: () => void } | null>(null)
const turnstileToken = ref('')
const turnstileKey = ref(0) // 递增以强制重新挂载 TurnstileWidget
const turnstileError = ref(false)

function retryTurnstile() {
  turnstileError.value = false
  turnstileToken.value = ''
  turnstileKey.value++
}

/** 打开弹窗时清空全部输入与验证状态：避免复用上次的（可能已过期）验证 token */
function openPasswordModal() {
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  showPw.value = false
  pwError.value = ''
  turnstileError.value = false
  turnstileToken.value = ''
  turnstileKey.value++
  showPasswordModal.value = true
}

async function submitPasswordChange() {
  pwError.value = ''
  if (!oldPassword.value) {
    pwError.value = '请输入当前密码'
    return
  }
  // 与服务端 registerSchema 同一份密码策略（services/auth.ts 的 passwordPolicyError）
  const policyError = passwordPolicyError(newPassword.value)
  if (policyError) {
    pwError.value = policyError
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pwError.value = '两次输入的新密码不一致'
    return
  }
  if (!isDesktop && !turnstileToken.value) {
    pwError.value = '请先完成人机验证'
    return
  }
  pwSaving.value = true
  try {
    await changePassword(oldPassword.value, newPassword.value, turnstileToken.value)
    showPasswordModal.value = false
    toast('密码已修改，其它设备需用新密码重新登录')
  } catch (e) {
    pwError.value = getErrorMessage(e, '修改失败，请重试')
    turnstileWidget.value?.reset()
  } finally {
    pwSaving.value = false
  }
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

async function exportBackup() {
  try {
    const blob = new Blob([await store.exportJSON()], { type: 'application/json' })
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
    <!-- 加载中 -->
    <div v-if="profileLoading" class="text-center text-xs text-slate-400 py-20">加载中…</div>
    <!-- 加载失败 -->
    <div v-else-if="profileError" class="card text-center py-10">
      <p class="text-xs text-slate-400">资料加载失败</p>
      <button class="btn-primary !text-xs mt-3" @click="reloadProfile">重试</button>
    </div>
    <template v-else-if="profile">
      <ProfileHeader :profile="profile" :is-self="true" @edit="showEdit = true" />
      <SocialStatsBar :profile="profile" :is-self="true" @show-works="worksTab = $event" />
      <UserWorksTabs :user-id="myId" :is-self="true" v-model:active-tab="worksTab" />
    </template>

    <!-- 账号安全（折叠，独立于 profile 加载状态，始终可用） -->
    <div class="card">
      <button class="w-full flex items-center justify-between" @click="showSecurity = !showSecurity">
        <span class="font-semibold text-sm">账号安全</span>
        <ChevronDown :size="16" class="transition-transform text-slate-400" :class="showSecurity ? 'rotate-180' : ''" />
      </button>
      <div v-if="showSecurity" class="mt-3 space-y-4">
        <div>
          <h2 class="font-semibold text-sm">登录用户名</h2>
          <p class="text-xs text-slate-400 mt-0.5">{{ user?.username }}（不可修改）</p>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold text-sm">密码</h2>
            <p class="text-xs text-slate-400 mt-0.5">修改成功后其它设备立即下线，需用新密码重新登录</p>
          </div>
          <button class="btn-primary !text-xs shrink-0" @click="openPasswordModal">修改密码</button>
        </div>
        <div class="space-y-1.5">
          <p class="text-[11px] text-slate-400 leading-relaxed">
            忘记密码？账号未绑定邮箱或手机号，无法自助找回；其它设备在线时可在本区块修改密码。
          </p>
          <a
            href="https://github.com/Han050912/zsb-study-tracker/issues/new"
            target="_blank"
            rel="noopener"
            class="btn-ghost !text-xs inline-flex"
            >全部设备都无法登录？提交 Issue 联系管理员处理 →</a
          >
        </div>
      </div>
    </div>

    <!-- 数据中心（折叠，独立于 profile 加载状态，始终可用） -->
    <div class="card">
      <button class="w-full flex items-center justify-between" @click="showDataCenter = !showDataCenter">
        <span class="font-semibold text-sm">数据中心</span>
        <ChevronDown
          :size="16"
          class="transition-transform text-slate-400"
          :class="showDataCenter ? 'rotate-180' : ''"
        />
      </button>
      <div v-if="showDataCenter" class="mt-3 space-y-4">
        <!-- 账号与云端数据信息 -->
        <div class="space-y-2.5">
          <h2 class="font-semibold text-sm">云端数据（Cloudflare D1）</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div class="flex justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
              <span class="text-slate-500 dark:text-slate-400">注册时间</span>
              <span>{{ fmtTime(user?.createdAt) }}</span>
            </div>
            <div class="flex justify-between bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
              <span class="text-slate-500 dark:text-slate-400">我的数据大小</span>
              <span>{{ myDataSize }}</span>
            </div>
          </div>
          <p class="text-[11px] text-slate-400">
            所有数据实时同步到云端数据库，多设备登录同一账号即可访问；建议定期导出备份作为应急恢复手段。
          </p>
        </div>

        <!-- 数据统计 -->
        <div>
          <h2 class="font-semibold text-sm mb-3">我的数据概览</h2>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div
              v-for="s in stats"
              :key="s.label"
              class="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2.5 text-center"
            >
              <div class="text-lg font-bold text-primary-600 dark:text-primary-400">
                {{ s.value }}<span class="text-xs font-normal text-slate-400 ml-0.5">{{ s.unit }}</span>
              </div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ s.label }}</div>
            </div>
          </div>
        </div>

        <!-- 数据操作 -->
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-semibold text-sm">数据备份</h2>
            <p class="text-xs text-slate-400 mt-0.5">导出当前账号全部数据为 JSON 文件，可在设置页导入恢复</p>
          </div>
          <button class="btn-primary !text-xs shrink-0" @click="exportBackup">导出备份</button>
        </div>
      </div>
    </div>

    <EditProfileModal v-model:show="showEdit" @saved="reloadProfile" />

    <!-- 修改密码 -->
    <Modal :show="showPasswordModal" title="修改密码" @close="showPasswordModal = false">
      <div class="space-y-3">
        <div class="flex justify-end">
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-primary-500 transition-colors"
            @click="showPw = !showPw"
          >
            {{ showPw ? '隐藏密码' : '显示密码' }}
          </button>
        </div>

        <div>
          <label class="label" for="old-password">当前密码</label>
          <input
            v-model="oldPassword"
            id="old-password"
            name="old-password"
            :type="showPw ? 'text' : 'password'"
            class="input"
            maxlength="64"
            autocomplete="current-password"
            placeholder="请输入当前密码"
          />
        </div>

        <div>
          <label class="label" for="new-password">新密码</label>
          <input
            v-model="newPassword"
            id="new-password"
            name="new-password"
            :type="showPw ? 'text' : 'password'"
            class="input"
            maxlength="64"
            autocomplete="new-password"
            placeholder="8-64 位"
          />
          <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">8-64 位，需同时包含字母和数字</p>
        </div>

        <div>
          <label class="label" for="confirm-new-password">确认新密码</label>
          <input
            v-model="confirmPassword"
            id="confirm-new-password"
            name="confirm-new-password"
            :type="showPw ? 'text' : 'password'"
            class="input"
            maxlength="64"
            autocomplete="new-password"
            placeholder="再次输入新密码"
          />
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
          <div>人机验证组件加载失败（Cloudflare CDN 在国内可能不稳定），请重试或稍后再试</div>
          <button
            type="button"
            class="text-xs text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 underline cursor-pointer"
            @click="retryTurnstile"
          >
            → 点击重试
          </button>
        </div>

        <div v-if="pwError" class="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
          {{ pwError }}
        </div>

        <p class="text-[11px] text-slate-400 leading-relaxed">
          修改成功后，该账号在其它设备上的登录会立即失效（需用新密码重新登录），本设备保持登录。
        </p>
      </div>
      <template #footer>
        <button class="btn-ghost" type="button" @click="showPasswordModal = false">取消</button>
        <button
          class="btn-primary"
          type="button"
          :disabled="pwSaving || (!isDesktop && !turnstileToken)"
          @click="submitPasswordChange"
        >
          {{ pwSaving ? '提交中…' : '确认修改' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
