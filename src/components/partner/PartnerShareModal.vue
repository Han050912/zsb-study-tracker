<script setup lang="ts">
/** 错题/笔记定向分享弹窗：列出我的搭子，点击即分享；成功 toast 并 emit done + close */
import { inject, onMounted, ref } from 'vue'
import { communityApi } from '../../api/community'
import Modal from '../Modal.vue'
import UserAvatar from '../community/UserAvatar.vue'
import type { PartnerItem } from '../../types'

const props = defineProps<{ itemType: 'error' | 'note'; itemId: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const toast = inject<(m: string) => void>('toast', () => {})

const partners = ref<PartnerItem[]>([])
const loading = ref(true)
const sending = ref('')

onMounted(async () => {
  try {
    const res = await communityApi.partners()
    partners.value = res.partners
  } catch (e: any) {
    toast(e?.message || '搭子列表加载失败')
  } finally {
    loading.value = false
  }
})

async function share(userId: string) {
  if (sending.value) return
  sending.value = userId
  try {
    await communityApi.createPartnerShare(userId, props.itemType, props.itemId)
    toast('已分享给搭子')
    emit('done')
    emit('close')
  } catch (e: any) {
    toast(e?.message || '分享失败')
  } finally {
    sending.value = ''
  }
}
</script>

<template>
  <Modal :title="itemType === 'error' ? '分享错题给搭子' : '分享笔记给搭子'" :show="true" @close="emit('close')">
    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="!partners.length" class="text-center text-xs text-slate-400 py-10">还没有搭子，先去搭子页添加一位吧</div>
    <div v-else class="space-y-1">
      <div class="text-[10px] text-slate-400 pb-1">选择一位搭子，TA 将收到这条{{ itemType === 'error' ? '错题' : '笔记' }}分享</div>
      <button v-for="p in partners" :key="p.userId"
        class="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
        :disabled="!!sending" @click="share(p.userId)">
        <UserAvatar :name="p.userName" :avatar="p.userAvatar" size="sm" />
        <span class="font-medium">{{ p.userName }}</span>
        <span class="ml-auto text-primary-500">{{ sending === p.userId ? '分享中…' : '分享' }}</span>
      </button>
    </div>
  </Modal>
</template>
