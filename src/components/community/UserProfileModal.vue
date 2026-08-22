<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '../Modal.vue'
import UserAvatar from './UserAvatar.vue'
import { communityApi } from '../../api/community'
import { COMMUNITY_BADGES, levelOf } from '../../data/defaults'
import { isAdmin, sessionUser, goLogin } from '../../services/auth'
import { fromNow } from '../../utils/date'
import type { CommunityUserProfile } from '../../types'

/**
 * 社区用户资料卡：等级 / 积分 / 连续打卡 / 徽章墙 / 专家认证（蓝 V）。
 * 管理员可在此授予/更新/撤销专家认证（含专长领域）。
 */
const props = defineProps<{ show: boolean; userId: string }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()
const router = useRouter()

const toast = inject<(m: string) => void>('toast', () => {})

const profile = ref<CommunityUserProfile | null>(null)
const loading = ref(false)
const loadError = ref(false)
/** 访客遇 login 可见性用户：后端 401，弹窗内引导登录而非报错 */
const needLogin = ref(false)
/** 目标用户确不存在：后端 404 */
const notFound = ref(false)

/** 徽章墙：目录全量展示，已获得的高亮 + 获得时间，未获得的置灰 */
const earnedMap = computed(() => new Map((profile.value?.badges ?? []).map(b => [b.key, b.awardedAt])))

const level = computed(() => levelOf(profile.value?.points ?? 0))
const isSelf = computed(() => props.userId === sessionUser.value?.id)
const canVerify = computed(() => isAdmin.value && !isSelf.value && !!profile.value)

watch(() => props.show, async v => {
  if (!v) return
  profile.value = null
  loadError.value = false
  needLogin.value = false
  notFound.value = false
  loading.value = true
  try {
    profile.value = await communityApi.profile(props.userId)
    expertiseInput.value = profile.value.expertise
  } catch (e: any) {
    // 401 = 访客遇 login 可见性用户 → 登录引导；404 = 用户不存在；其余 = 加载失败
    needLogin.value = e?.status === 401
    notFound.value = e?.status === 404
    loadError.value = !needLogin.value && !notFound.value
  } finally {
    loading.value = false
  }
})

// ---- 关注/取关 ----
const followSubmitting = ref(false)

async function toggleFollow() {
  if (!profile.value || followSubmitting.value) return
  followSubmitting.value = true
  try {
    const res = await communityApi.follow(props.userId)
    profile.value.followedByMe = res.following
    profile.value.followers += res.following ? 1 : -1
    toast(res.following ? '已关注，对方的帖子会出现在「关注」Tab' : '已取消关注')
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { followSubmitting.value = false }
}

// ---- 管理员：专家认证 ----
const expertiseInput = ref('')
const verifySubmitting = ref(false)

async function grantVerify() {
  const expertise = expertiseInput.value.trim()
  if (!expertise) { toast('请填写专长领域'); return }
  if (!profile.value || verifySubmitting.value) return
  verifySubmitting.value = true
  try {
    const res = await communityApi.adminVerifyUser(props.userId, expertise)
    profile.value.verified = true
    profile.value.expertise = res.expertise
    toast('已授予专家认证')
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { verifySubmitting.value = false }
}

async function revokeVerify() {
  if (!profile.value || verifySubmitting.value) return
  if (!window.confirm(`确认撤销 ${profile.value.userName} 的专家认证？`)) return
  verifySubmitting.value = true
  try {
    await communityApi.adminUnverifyUser(props.userId)
    profile.value.verified = false
    profile.value.expertise = ''
    expertiseInput.value = ''
    toast('已撤销认证')
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { verifySubmitting.value = false }
}
</script>

<template>
  <Modal :show="show" title="用户资料" @close="emit('update:show', false)">
    <div v-if="loading" class="text-center text-xs text-slate-400 py-8">加载中…</div>
    <div v-else-if="needLogin" class="text-center py-8 space-y-3">
      <div class="text-xs text-slate-400">该用户仅对登录用户公开主页</div>
      <button class="btn-primary !py-1.5 !text-xs" @click="emit('update:show', false); goLogin(router)">🔑 登录查看</button>
    </div>
    <div v-else-if="notFound" class="text-center text-xs text-slate-400 py-8">用户不存在</div>
    <div v-else-if="loadError" class="text-center text-xs text-slate-400 py-8">加载失败</div>

    <template v-else-if="profile">
      <!-- 头部：头像 / 昵称 / 等级 / 蓝 V / 关注 -->
      <div class="flex items-center gap-3">
        <UserAvatar :name="profile.userName" :avatar="profile.avatar" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-semibold truncate">{{ profile.userName }}</span>
            <span v-if="profile.verified"
              class="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 shrink-0"
              :title="`认证专家：${profile.expertise}`">
              <span class="w-3 h-3 rounded-full bg-sky-500 text-white text-[8px] flex items-center justify-center">✓</span>
              {{ profile.expertise }}专家
            </span>
            <span v-if="!profile.profilePrivate" class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              :style="{ background: level.color + '1a', color: level.color }">{{ level.name }}学者</span>
          </div>
        </div>
        <div v-if="!isSelf && !profile.profilePrivate" class="shrink-0 flex items-center gap-1.5">
          <button class="text-xs px-2 py-1.5 rounded-full font-medium transition-colors bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-primary-500"
            @click="emit('update:show', false); router.push(`/profile/${userId}`)">📊 主页</button>
          <button class="text-xs px-2 py-1.5 rounded-full font-medium transition-colors bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-primary-500"
            @click="emit('update:show', false); router.push(`/community/messages/${userId}`)">✉️ 私信</button>
          <button class="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
            :class="profile.followedByMe
              ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-red-500'
              : 'bg-primary-500 text-white hover:bg-primary-600'"
            :disabled="followSubmitting" @click="toggleFollow">
            {{ profile.followedByMe ? '已关注' : '+ 关注' }}
          </button>
        </div>
      </div>

      <!-- 隐私保护提示（私密主页降级视图） -->
      <div v-if="profile.profilePrivate" class="mt-4 text-center text-xs text-slate-400 py-3 rounded-lg bg-slate-50 dark:bg-slate-700/40">
        🔒 该用户已开启隐私保护，仅展示部分公开信息
      </div>

      <!-- 荣誉统计 -->
      <div v-if="!profile.profilePrivate" class="grid grid-cols-5 gap-2 mt-4 text-center">
        <div class="rounded-lg bg-slate-50 dark:bg-slate-700/40 py-2">
          <div class="text-sm font-bold text-primary-500">{{ profile.points }}</div>
          <div class="text-[10px] text-slate-400">积分</div>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-700/40 py-2">
          <div class="text-sm font-bold text-orange-500">{{ profile.streak }}</div>
          <div class="text-[10px] text-slate-400">连续打卡</div>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-700/40 py-2">
          <div class="text-sm font-bold text-emerald-500">{{ profile.postCount }}</div>
          <div class="text-[10px] text-slate-400">发帖评论</div>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-700/40 py-2">
          <div class="text-sm font-bold text-rose-500">{{ profile.likesReceived }}</div>
          <div class="text-[10px] text-slate-400">获赞</div>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-700/40 py-2">
          <div class="text-sm font-bold text-sky-500">{{ profile.followers }}</div>
          <div class="text-[10px] text-slate-400">粉丝</div>
        </div>
      </div>

      <!-- 徽章墙 -->
      <div v-if="!profile.profilePrivate" class="label mt-4">徽章墙（{{ profile.badges.length }}/{{ COMMUNITY_BADGES.length }}）</div>
      <div v-if="!profile.profilePrivate" class="grid grid-cols-4 gap-2">
        <div v-for="b in COMMUNITY_BADGES" :key="b.key"
          class="rounded-lg py-2 px-1 text-center transition-opacity"
          :class="earnedMap.has(b.key) ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-slate-50 dark:bg-slate-700/40 opacity-40 grayscale'"
          :title="earnedMap.has(b.key) ? `${b.desc}（${fromNow(earnedMap.get(b.key)!)}获得）` : `${b.desc}（未获得）`">
          <div class="text-lg leading-6">{{ b.icon }}</div>
          <div class="text-[10px] font-medium truncate">{{ b.name }}</div>
        </div>
      </div>

      <!-- 管理员：专家认证操作 -->
      <div v-if="canVerify && !profile.profilePrivate" class="mt-4 rounded-lg border border-sky-100 dark:border-sky-900/50 p-3 space-y-2">
        <div class="text-xs font-semibold text-sky-600 dark:text-sky-400">🛡️ 管理员 · 专家认证</div>
        <input v-model="expertiseInput" maxlength="50" class="input !py-1.5 text-xs"
          placeholder="专长领域，如：高等数学 / 英语" />
        <div class="flex gap-2 justify-end">
          <button v-if="profile.verified" class="btn-ghost !text-xs !text-red-500" :disabled="verifySubmitting"
            @click="revokeVerify">撤销认证</button>
          <button class="btn-primary !text-xs" :disabled="verifySubmitting" @click="grantVerify">
            {{ profile.verified ? '更新专长' : '授予认证' }}
          </button>
        </div>
      </div>
    </template>
  </Modal>
</template>
