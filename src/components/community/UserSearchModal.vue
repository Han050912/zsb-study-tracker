<script setup lang="ts">
/** 找用户搜索弹窗：输入对外用户 ID，精确查找并展示结果卡片 + 关注/进主页 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '../Modal.vue'
import UserAvatar from './UserAvatar.vue'
import FollowButton from '../profile/FollowButton.vue'
import { communityApi } from '../../api/community'
import type { UserLookupResult } from '../../types'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()
const router = useRouter()

const keyword = ref('')
const searching = ref(false)
const result = ref<UserLookupResult | null>(null)
const notFound = ref(false)
const error = ref(false)

async function search() {
  const key = keyword.value.trim()
  if (!key || searching.value) return
  searching.value = true
  result.value = null
  notFound.value = false
  error.value = false
  try {
    result.value = await communityApi.lookup(key)
  } catch (e: any) {
    if (e?.status === 404) notFound.value = true
    else error.value = true
  } finally {
    searching.value = false
  }
}

function onFollowChange(following: boolean) {
  if (result.value) result.value.followedByMe = following
}

function goProfile() {
  if (!result.value) return
  emit('update:show', false)
  router.push(`/profile/${result.value.userId}`)
}
</script>

<template>
  <Modal :show="show" title="找用户" @close="emit('update:show', false)">
    <!-- 搜索框 -->
    <div class="flex gap-2">
      <input v-model="keyword" class="input flex-1" placeholder="输入用户ID"
        maxlength="32" @keydown.enter="search" />
      <button class="btn-primary !text-xs shrink-0" :disabled="searching" @click="search">
        {{ searching ? '搜索中' : '搜索' }}
      </button>
    </div>

    <!-- 结果卡片 -->
    <div v-if="result" class="mt-4 flex items-center gap-3">
      <UserAvatar :name="result.userName" :avatar="result.avatar" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-semibold truncate">{{ result.userName }}</span>
          <span v-if="result.verified" class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0" title="认证专家">✓</span>
        </div>
        <div class="text-xs text-slate-400 mt-0.5">用户ID：{{ result.userCode }}</div>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{{ result.bio || '这个人很懒，什么都没写' }}</p>
      </div>
      <div class="shrink-0 flex items-center gap-1.5">
        <button class="text-xs px-2 py-1.5 rounded-full font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-primary-500" @click="goProfile">主页</button>
        <FollowButton :user-id="result.userId" :followed-by-me="result.followedByMe"
          :follows-me="result.followsMe" @change="onFollowChange" />
      </div>
    </div>

    <!-- 状态提示 -->
    <div v-else-if="notFound" class="mt-4 text-center text-xs text-slate-400 py-4">未找到该用户</div>
    <div v-else-if="error" class="mt-4 text-center text-xs text-slate-400 py-4">搜索失败，请重试</div>
    <div v-else class="mt-4 text-center text-xs text-slate-400 py-4">输入用户ID进行查找</div>
  </Modal>
</template>
