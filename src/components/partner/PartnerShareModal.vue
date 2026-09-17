<script setup lang="ts">
import { usePartnerStore } from '../../features/collaboration/stores/partners'
import { storeToRefs } from 'pinia'
const partnerStore = usePartnerStore()
/** 错题/笔记定向分享弹窗：列出我的搭子，点击即分享；重复分享时二次确认 */
import { computed, onMounted, ref } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { partnersApi } from '../../api/community/partners'
import { useAppStore } from '../../stores/app'
import { TriangleAlert } from '@lucide/vue'
import Modal from '../Modal.vue'
import UserAvatar from '../community/UserAvatar.vue'

const props = defineProps<{ itemType: 'error' | 'note'; itemId: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const toast = useToast()
const store = useAppStore()

const { partners } = storeToRefs(partnerStore)
const loading = ref(true)
const sending = ref('')

// 前置引导：未开启「允许搭子查看我的学习数据」时提示去设置开启（复用本地 settings，不新增接口）
const shareEnabled = computed(() => store.settings.partnerShareEnabled)
/** 服务端 403 拒绝（本地开关状态可能滞后）：同样落到下方引导块 */
const shareRejected = ref(false)
const needShareGuide = computed(() => !shareEnabled.value || shareRejected.value)

// 重复分享二次确认
const confirmOpen = ref(false)
const pendingPartnerId = ref('')

onMounted(async () => {
  try {
    await partnerStore.load()
  } catch (e) {
    toast(getErrorMessage(e, '搭子列表加载失败'))
  } finally {
    loading.value = false
  }
})

async function share(userId: string) {
  if (sending.value) return
  sending.value = userId
  try {
    const res = await partnersApi.createPartnerShare(userId, props.itemType, props.itemId)
    if (res.duplicate) {
      // 重复分享：弹出二次确认
      pendingPartnerId.value = userId
      confirmOpen.value = true
      return
    }
    toast('已分享给搭子')
    emit('done')
    emit('close')
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 403) {
      // 403 = 未开启数据共享：持久展示弹窗内引导（替代一次性 toast）
      shareRejected.value = true
    } else {
      toast(getErrorMessage(e, '分享失败'))
    }
  } finally {
    sending.value = ''
  }
}

async function confirmShare() {
  if (sending.value) return
  sending.value = pendingPartnerId.value
  try {
    await partnersApi.createPartnerShare(pendingPartnerId.value, props.itemType, props.itemId, true)
    toast('已分享给搭子')
    emit('done')
    emit('close')
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 403) {
      shareRejected.value = true
      confirmOpen.value = false
    } else {
      toast(getErrorMessage(e, '分享失败'))
    }
  } finally {
    sending.value = ''
  }
}

function cancelShare() {
  confirmOpen.value = false
  emit('close')
}
</script>

<template>
  <Modal :title="itemType === 'error' ? '分享错题给搭子' : '分享笔记给搭子'" :show="true" @close="emit('close')">
    <!-- 重复分享二次确认（阻断式） -->
    <div v-if="confirmOpen" class="space-y-4 py-2">
      <p class="text-sm text-slate-600 dark:text-slate-300">这条内容已分享过该搭子，是否继续分享？</p>
      <div class="flex justify-end gap-2">
        <button class="btn-ghost !text-xs" @click="cancelShare">否</button>
        <button class="btn-primary !text-xs" :disabled="!!sending" @click="confirmShare">
          {{ sending ? '分享中…' : '是' }}
        </button>
      </div>
    </div>

    <!-- 搭子列表 -->
    <div v-else-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="!partners.length" class="text-center text-xs text-slate-400 py-10">
      还没有搭子，先去搭子页添加一位吧
    </div>
    <div v-else class="space-y-1">
      <!-- 分享前置引导：未开启「允许搭子查看我的学习数据」时提示去设置开启（可跳转设置） -->
      <div
        v-if="needShareGuide"
        class="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs p-2.5 mb-1"
      >
        <TriangleAlert :size="14" aria-hidden="true" class="shrink-0 mt-0.5" />
        <span class="flex-1">你尚未开启「允许搭子查看我的学习数据」，分享的内容搭子将无法查看。</span>
        <router-link to="/settings" class="shrink-0 underline underline-offset-2" @click="emit('close')">
          去设置开启
        </router-link>
      </div>
      <div class="text-[10px] text-slate-400 pb-1">
        选择一位搭子，TA 将收到这条{{ itemType === 'error' ? '错题' : '笔记' }}分享
      </div>
      <button
        v-for="p in partners"
        :key="p.userId"
        class="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
        :disabled="!!sending"
        @click="share(p.userId)"
      >
        <UserAvatar :name="p.userName" :avatar="p.userAvatar" size="sm" />
        <span class="font-medium">{{ p.userName }}</span>
        <span class="ml-auto text-primary-500">{{ sending === p.userId ? '分享中…' : '分享' }}</span>
      </button>
    </div>
  </Modal>
</template>
