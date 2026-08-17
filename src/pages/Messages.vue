<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import { fromNow } from '../utils/date'
import type { MessageConversation } from '../types'

/** 私信会话列表：每对话方最新一条 + 未读数，点击进入聊天 */
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const conversations = ref<MessageConversation[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await communityApi.conversations()
    conversations.value = res.conversations
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="space-y-3 max-w-2xl mx-auto">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" @click="router.push('/community')">← 广场</button>
      <h2 class="text-lg font-bold flex-1">✉️ 私信</h2>
    </div>

    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="!conversations.length" class="card text-center text-sm text-slate-400 py-10">
      还没有私信。到社区里找聊得来的同学，点头像 → 发私信吧～
    </div>

    <div v-else class="card !p-0 divide-y divide-slate-100 dark:divide-slate-700">
      <button v-for="c in conversations" :key="c.peerId"
        class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
        @click="router.push(`/community/messages/${c.peerId}`)">
        <UserAvatar :name="c.peerName" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-semibold truncate">{{ c.peerName }}</span>
            <span v-if="c.peerVerified"
              class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0" title="认证专家">✓</span>
            <span class="text-[10px] text-slate-400 ml-auto shrink-0">{{ fromNow(c.lastAt) }}</span>
          </div>
          <div class="text-xs text-slate-400 truncate mt-0.5">
            {{ c.lastFromMe ? '我：' : '' }}{{ c.lastContent }}
          </div>
        </div>
        <span v-if="c.unread" class="shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
          {{ c.unread > 99 ? '99+' : c.unread }}
        </span>
      </button>
    </div>
  </div>
</template>
