<script setup lang="ts">
/** 个人主页头部：粘土质感 Banner + 悬浮资料卡（头像/昵称/蓝V/等级/简介/积分打卡 + 本人编辑或访客关注/私信操作） */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BadgeCheck, Camera } from '@lucide/vue'
import type { CommunityUserProfile } from '../../types'
import { imageUrl } from '../../api/community'
import { levelOf } from '../../data/defaults'
import { requireLogin } from '../../services/auth'
import FollowButton from './FollowButton.vue'

const props = defineProps<{ profile: CommunityUserProfile; isSelf: boolean }>()
const emit = defineEmits<{ edit: []; 'follow-change': [following: boolean] }>()
const router = useRouter()
const level = computed(() => levelOf(props.profile.points))

// 头像加载失败回退首字母渐变（同 UserAvatar 口径）；换新头像后允许重新尝试加载
const avatarFailed = ref(false)
watch(() => props.profile.avatar, () => { avatarFailed.value = false })

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
    <!-- 粘土质感 Banner -->
    <div class="clay-banner h-28 md:h-36"></div>

    <!-- 悬浮资料卡 -->
    <div class="-mt-10 mx-3 card relative flex items-center gap-4">
      <!-- 头像区：本人态可点击编辑资料（悬停显示 Camera 遮罩，参考 Account.vue group-hover 模式） -->
      <div class="relative w-20 h-20 shrink-0" :class="isSelf ? 'cursor-pointer group' : ''"
        :title="isSelf ? '编辑资料' : undefined" @click="onAvatarClick">
        <img v-if="profile.avatar && !avatarFailed" :src="imageUrl(profile.avatar)" alt="" loading="lazy"
          class="w-20 h-20 rounded-full object-cover ring-4 ring-white dark:ring-slate-800 bg-slate-200 dark:bg-slate-700"
          @error="avatarFailed = true">
        <div v-else
          class="w-20 h-20 rounded-full ring-4 ring-white dark:ring-slate-800 bg-gradient-to-br from-primary-500 to-indigo-600 text-white text-2xl font-bold flex items-center justify-center select-none">
          {{ (profile.userName || '升').trim().slice(0, 1).toUpperCase() }}
        </div>
        <span v-if="isSelf"
          class="absolute inset-0 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Camera :size="22" aria-hidden="true" />
        </span>
      </div>

      <!-- 信息区 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-xl font-bold truncate">{{ profile.userName }}</span>
          <BadgeCheck v-if="profile.verified" :size="14" class="text-sky-500 shrink-0" aria-hidden="true" />
          <span v-if="!profile.profilePrivate" class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            :style="{ background: level.color + '1a', color: level.color }">{{ level.name }}学者</span>
        </div>
        <div class="text-xs text-slate-400 mt-0.5">用户ID：{{ profile.userCode ?? '' }}</div>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
          {{ profile.bio || '这个人很懒，什么都没写' }}</p>
        <div class="text-xs text-slate-400 mt-1">
          <span v-if="!profile.profilePrivate">{{ profile.points }} 积分 · {{ profile.streak }} 天连续打卡<template v-if="profile.expertise"> · </template></span>
          <span v-if="profile.expertise">专长：{{ profile.expertise }}</span>
        </div>
      </div>

      <!-- 操作区 -->
      <div class="shrink-0 flex items-center gap-2">
        <button v-if="isSelf" class="btn-primary !text-xs" @click="emit('edit')">编辑资料</button>
        <template v-else>
          <FollowButton :user-id="profile.userId" :followed-by-me="profile.followedByMe"
            :follows-me="profile.followsMe" @change="f => emit('follow-change', f)" />
          <button
            class="text-xs px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-primary-500 transition-colors"
            @click="goMessage">消息</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 粘土质感（claymorphism）：柔和粉彩底 + 外部投影 + 内部高光，营造柔软凸起的黏土感 */
.clay-banner {
  border-radius: 1.5rem;
  background: linear-gradient(135deg, #b8d4ff 0%, #cdbaff 55%, #ffcce4 100%);
  box-shadow:
    10px 16px 32px rgba(84, 94, 150, 0.18),
    -6px -8px 24px rgba(255, 255, 255, 0.65),
    inset 3px 3px 8px rgba(255, 255, 255, 0.95),
    inset -5px -5px 12px rgba(92, 92, 165, 0.14);
}

:global(.dark) .clay-banner {
  background: linear-gradient(135deg, #1d3f8f 0%, #3b2e8f 55%, #7c2d86 100%);
  box-shadow:
    10px 16px 32px rgba(0, 0, 0, 0.45),
    -4px -6px 16px rgba(255, 255, 255, 0.05),
    inset 2px 2px 6px rgba(255, 255, 255, 0.1),
    inset -5px -5px 12px rgba(0, 0, 0, 0.4);
}
</style>
