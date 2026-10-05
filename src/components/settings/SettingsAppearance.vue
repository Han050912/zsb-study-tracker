<script setup lang="ts">
/** 外观与提醒卡：主题切换、每日提醒、社区可见性、搭子权限、勿扰模式 */
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { isDesktopNotify, notifyPermission, requestNotifyPermission } from '../../services/notify'
import type { NotificationType } from '../../types'

const store = useAppStore()
const toast = useToast()
const s = computed(() => store.settings)

function update(key: string, value: any) {
  store.updateSettings({ [key]: value })
}

function applyTheme(t: string) {
  update('theme', t)
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

// 统一通知权限（桌面端经 preload 桥接原生通知，无需授权；浏览器端走 Web Notification）
const notifSupported = isDesktopNotify() || (typeof window !== 'undefined' && 'Notification' in window)
const notifPermission = ref(notifyPermission())
const reminderPending = ref(false)

async function toggleReminder(v: boolean) {
  if (reminderPending.value) return
  // 提醒偏好立即落盘；系统通知授权只影响送达方式，不覆盖用户选择。
  update('reminderEnabled', v)
  if (!v) {
    toast('已关闭提醒')
    return
  }
  reminderPending.value = true
  try {
    if (notifSupported) {
      try {
        notifPermission.value = await requestNotifyPermission()
      } catch {
        notifPermission.value = 'default'
      }
    }
    toast(
      notifPermission.value === 'granted' || notifPermission.value === 'desktop'
        ? '已开启每日提醒（保持应用运行有效）'
        : '已开启每日提醒；系统通知未授权，将在应用内提醒（保持应用运行有效）'
    )
  } finally {
    reminderPending.value = false
  }
}

// ---- 勿扰模式 ----
const notifTypeOptions: { k: NotificationType; l: string }[] = [
  { k: 'like', l: '点赞' },
  { k: 'comment', l: '评论' },
  { k: 'follow', l: '关注' },
  { k: 'achievement', l: '成就' },
  { k: 'partner', l: '搭子' },
  { k: 'system', l: '系统' }
]
function toggleMutedType(t: NotificationType) {
  const list = [...s.value.dndMutedTypes]
  const i = list.indexOf(t)
  if (i >= 0) list.splice(i, 1)
  else list.push(t)
  update('dndMutedTypes', list)
}
</script>

<template>
  <!-- 外观 -->
  <div class="card space-y-4">
    <div class="section-title">外观</div>
    <div class="flex gap-2">
      <button
        v-for="t in [
          { k: 'light', l: '浅色' },
          { k: 'dark', l: '深色' },
          { k: 'auto', l: '跟随系统' }
        ]"
        :key="t.k"
        class="btn flex-1"
        :class="s.theme === t.k ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
        :aria-pressed="s.theme === t.k"
        @click="applyTheme(t.k)"
      >
        {{ t.l }}
      </button>
    </div>
    <h2 class="section-title !mb-0 pt-4 border-t border-line">提醒</h2>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm">每日学习提醒</span>
      <div class="flex items-center gap-2">
        <input
          type="time"
          aria-label="每日提醒时间"
          :value="s.reminderTime"
          class="input !w-auto !py-1"
          @change="update('reminderTime', ($event.target as HTMLInputElement).value)"
        />
        <button
          class="btn !text-xs shrink-0 min-w-16 whitespace-nowrap"
          :class="s.reminderEnabled ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
          role="switch"
          :aria-checked="s.reminderEnabled"
          aria-label="每日学习提醒"
          :disabled="reminderPending"
          @click="toggleReminder(!s.reminderEnabled)"
        >
          {{ s.reminderEnabled ? '已开启' : '已关闭' }}
        </button>
      </div>
    </div>
  </div>
  <div class="card space-y-4">
    <h2 class="section-title">社区与搭子权限</h2>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-sm">参与学习进步榜</span>
        <p class="text-xs text-slate-400 mt-0.5">在社区「进步榜」展示昵称与学习时长/刷题数排名，默认关闭</p>
      </div>
      <button
        class="btn !text-xs shrink-0 min-w-16 whitespace-nowrap"
        :class="s.joinProgressBoard ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
        role="switch"
        :aria-checked="s.joinProgressBoard"
        aria-label="参与学习进步榜"
        @click="update('joinProgressBoard', !s.joinProgressBoard)"
      >
        {{ s.joinProgressBoard ? '已参与' : '未参与' }}
      </button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-sm">主页可见性</span>
        <p class="text-xs text-slate-400 mt-0.5">控制他人访问你成长主页的权限</p>
      </div>
      <select
        class="input !w-auto !py-1.5 !text-xs"
        aria-label="主页可见性"
        :value="s.profileVisibility"
        @change="
          update('profileVisibility', ($event.target as HTMLSelectElement).value as 'public' | 'login' | 'private')
        "
      >
        <option value="public">公开（所有人可见）</option>
        <option value="login">仅登录用户可见</option>
        <option value="private">仅自己可见</option>
      </select>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-sm">在主页公开学习数据</span>
        <p class="text-xs text-slate-400 mt-0.5">
          向有权访问主页的人展示积分、连续打卡、学习热力图和学习统计，并参与打卡榜，默认关闭
        </p>
      </div>
      <button
        type="button"
        class="btn !text-xs shrink-0 min-w-16 whitespace-nowrap"
        :class="s.shareLearningStats ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
        role="switch"
        :aria-checked="s.shareLearningStats"
        aria-label="在主页公开学习数据"
        @click="update('shareLearningStats', !s.shareLearningStats)"
      >
        {{ s.shareLearningStats ? '已公开' : '仅自己可见' }}
      </button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-sm">允许搭子查看我的学习数据</span>
        <p class="text-xs text-slate-400 mt-0.5">开启后搭子可查看你的周报对比与定向分享内容，默认关闭</p>
      </div>
      <button
        class="btn !text-xs shrink-0 min-w-16 whitespace-nowrap"
        :class="s.partnerShareEnabled ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
        role="switch"
        :aria-checked="s.partnerShareEnabled"
        aria-label="允许搭子查看学习数据"
        @click="update('partnerShareEnabled', !s.partnerShareEnabled)"
      >
        {{ s.partnerShareEnabled ? '已开启' : '已关闭' }}
      </button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-sm">允许搭子向我发送学习提醒</span>
        <p class="text-xs text-slate-400 mt-0.5">关闭后搭子将无法向你发送学习鼓励提醒，默认开启</p>
      </div>
      <button
        class="btn !text-xs shrink-0 min-w-16 whitespace-nowrap"
        :class="s.partnerRemindEnabled ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
        role="switch"
        :aria-checked="s.partnerRemindEnabled"
        aria-label="允许搭子发送学习提醒"
        @click="update('partnerRemindEnabled', !s.partnerRemindEnabled)"
      >
        {{ s.partnerRemindEnabled ? '已开启' : '已关闭' }}
      </button>
    </div>
    <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span class="text-sm">勿扰模式</span>
          <p class="text-xs text-slate-400 mt-0.5">开启后不弹数字角标、不弹系统推送，通知中心照常记录历史</p>
        </div>
        <button
          class="btn !text-xs shrink-0 min-w-16 whitespace-nowrap"
          :class="s.doNotDisturb ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
          role="switch"
          :aria-checked="s.doNotDisturb"
          aria-label="勿扰模式"
          @click="update('doNotDisturb', !s.doNotDisturb)"
        >
          {{ s.doNotDisturb ? '已开启' : '已关闭' }}
        </button>
      </div>
      <div v-if="s.doNotDisturb" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="set-dnd-start">开始时间（留空=全天）</label
            ><input
              id="set-dnd-start"
              type="time"
              :value="s.dndStartTime"
              class="input"
              @change="update('dndStartTime', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div>
            <label class="label" for="set-dnd-end">结束时间（留空=全天）</label
            ><input
              id="set-dnd-end"
              type="time"
              :value="s.dndEndTime"
              class="input"
              @change="update('dndEndTime', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <div>
          <div class="label">屏蔽的提醒类型（勿扰期间不提示）</div>
          <div class="flex flex-wrap gap-2 mt-1">
            <button
              v-for="t in notifTypeOptions"
              :key="t.k"
              class="btn !text-xs !py-1 !px-2.5"
              :class="s.dndMutedTypes.includes(t.k) ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
              :aria-pressed="s.dndMutedTypes.includes(t.k)"
              @click="toggleMutedType(t.k)"
            >
              {{ t.l }}
            </button>
            <button
              class="btn !text-xs !py-1 !px-2.5"
              :class="s.dndMuteMessage ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
              role="switch"
              :aria-checked="s.dndMuteMessage"
              aria-label="屏蔽消息提醒"
              @click="update('dndMuteMessage', !s.dndMuteMessage)"
            >
              消息
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="!notifSupported" class="text-xs text-action">
      当前浏览器不支持系统通知，每日提醒将在应用内显示，需保持应用运行。
    </p>
    <p v-else-if="notifPermission === 'denied'" class="text-xs text-correction">
      系统通知权限已被拒绝，每日提醒将在应用内显示。可在浏览器站点设置中允许通知，需保持应用运行。
    </p>
    <p v-else-if="notifPermission === 'default'" class="text-xs text-slate-400">开启提醒时会请求浏览器通知权限。</p>
    <p v-else class="text-xs text-action">通知权限已授权。</p>
  </div>
</template>
