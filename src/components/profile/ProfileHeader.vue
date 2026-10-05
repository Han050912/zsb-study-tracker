<script setup lang="ts">
/** 姓名与备考介绍优先，等级降为文字，保留编辑、关注和私信入口。 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BadgeCheck, Camera } from '@lucide/vue'
import type { CommunityUserProfile } from '../../types'
import { imageUrl } from '../../api/community'
import { levelOf } from '../../data/defaults'
import { requireLogin } from '../../services/auth'
import { useAppStore } from '../../stores/app'
import FollowButton from './FollowButton.vue'

const props = defineProps<{ profile: CommunityUserProfile; isSelf: boolean }>()
const emit = defineEmits<{ edit: []; 'follow-change': [following: boolean] }>()
const router = useRouter()
const store = useAppStore()
const level = computed(() => levelOf(props.profile.points ?? 0))
const avatar = computed(() => (props.isSelf ? store.settings.avatar : props.profile.avatar))

// 头像加载失败回退首字母渐变（同 UserAvatar 口径）；换新头像后允许重新尝试加载
const avatarFailed = ref(false)
watch(avatar, () => {
  avatarFailed.value = false
})

function onAvatarClick() {
  if (props.isSelf) emit('edit')
}

/** 发起私聊：访客先引导登录 */
function goMessage() {
  if (requireLogin(router)) return
  router.push(`/messages/${props.profile.userId}`)
}
</script>

<template>
  <div>
    <div class="profile-summary">
      <!-- 头像区：本人态可点击编辑资料（悬停显示 Camera 遮罩，参考 Account.vue group-hover 模式） -->
      <div
        class="relative w-20 h-20 shrink-0"
        :class="isSelf ? 'cursor-pointer group' : ''"
        :title="isSelf ? '编辑资料' : undefined"
        :role="isSelf ? 'button' : undefined"
        :tabindex="isSelf ? 0 : undefined"
        :aria-label="isSelf ? '编辑头像和资料' : undefined"
        @click="onAvatarClick"
        @keydown.enter="onAvatarClick"
        @keydown.space.prevent="onAvatarClick"
      >
        <img
          v-if="avatar && !avatarFailed"
          :src="imageUrl(avatar)"
          alt=""
          loading="lazy"
          class="w-20 h-20 rounded-full object-cover ring-4 ring-white dark:ring-slate-800 bg-slate-200 dark:bg-slate-700"
          @error="avatarFailed = true"
        />
        <div
          v-else
          class="w-20 h-20 rounded-full ring-4 ring-white dark:ring-slate-800 bg-action-soft text-action text-2xl font-bold flex items-center justify-center select-none"
        >
          {{ (profile.userName || '升').trim().slice(0, 1).toUpperCase() }}
        </div>
        <span
          v-if="isSelf"
          class="absolute inset-0 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center justify-center"
        >
          <Camera :size="22" aria-hidden="true" />
        </span>
      </div>

      <!-- 信息区 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-xl font-bold truncate">{{ profile.userName }}</span>
          <BadgeCheck v-if="profile.verified" :size="14" class="text-action shrink-0" aria-hidden="true" />
          <span
            v-if="!profile.profilePrivate && !profile.learningStatsPrivate"
            class="text-xs px-1.5 py-0.5 rounded-full shrink-0"
            :style="{ color: 'var(--muted)' }"
            >{{ level.name }}学者</span
          >
        </div>
        <div class="text-xs text-slate-400 mt-0.5">用户ID：{{ profile.userCode ?? '' }}</div>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
          {{ profile.bio || '还没有填写备考介绍' }}
        </p>
        <div class="text-xs text-slate-400 mt-1">
          <span v-if="!profile.profilePrivate && !profile.learningStatsPrivate"
            >{{ profile.points }} 积分 · {{ profile.streak }} 天连续打卡<template v-if="profile.expertise">
              ·
            </template></span
          >
          <span v-if="profile.expertise">专长：{{ profile.expertise }}</span>
        </div>
      </div>

      <!-- 操作区 -->
      <div class="w-full sm:w-auto shrink-0 flex items-center justify-end gap-2">
        <button v-if="isSelf" class="btn-primary !text-xs" @click="emit('edit')">编辑资料</button>
        <template v-else>
          <FollowButton
            :user-id="profile.userId"
            :followed-by-me="profile.followedByMe"
            :follows-me="profile.followsMe"
            @change="(f) => emit('follow-change', f)"
          />
          <button
            class="text-xs px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-action transition-colors"
            @click="goMessage"
          >
            消息
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
