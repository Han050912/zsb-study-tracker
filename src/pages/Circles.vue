<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import Modal from '../components/Modal.vue'
import type { CommunityCircle } from '../types'

/** 话题圈子列表：全部圈子（按成员数倒序）+ 建圈入口 */
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const circles = ref<CommunityCircle[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await communityApi.circles()
    circles.value = res.circles
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
})

// ---- 建圈 ----
const showCreate = ref(false)
const createName = ref('')
const createDesc = ref('')
const createPublic = ref(true)
const creating = ref(false)

async function submitCreate() {
  const name = createName.value.trim()
  if (!name) { toast('请填写圈子名称'); return }
  if (creating.value) return
  creating.value = true
  try {
    const c = await communityApi.createCircle({ name, description: createDesc.value.trim(), isPublic: createPublic.value })
    showCreate.value = false
    createName.value = createDesc.value = ''
    createPublic.value = true
    circles.value.unshift({ ...c, memberCount: 1 })
    toast('圈子已创建 🎉')
    router.push(`/community/circles/${c.id}`)
  } catch (e: any) {
    toast(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

const statusLabel = (c: CommunityCircle) =>
  c.myStatus === 'owner' ? '我是圈主' : c.myStatus === 'member' ? '已加入' : c.myStatus === 'pending' ? '待审批' : null
</script>

<template>
  <div class="space-y-4 max-w-3xl mx-auto">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" @click="router.push('/community')">← 广场</button>
      <h2 class="text-lg font-bold flex-1">话题圈子</h2>
      <button class="btn-primary !text-xs" @click="showCreate = true">＋ 创建圈子</button>
    </div>
    <p class="text-xs text-slate-400">圈内专属讨论——圈子帖子不会出现在公共广场。公开圈可直接加入，审核圈需圈主批准。</p>

    <div v-if="loading" class="text-center text-xs text-slate-400 py-8">加载中…</div>
    <div v-else-if="!circles.length" class="card text-center text-sm text-slate-400 py-10">还没有圈子，来创建第一个吧～</div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <button v-for="c in circles" :key="c.id" class="card !p-4 text-left hover:shadow-md transition-shadow"
        @click="router.push(`/community/circles/${c.id}`)">
        <div class="flex items-center gap-2">
          <span class="font-semibold truncate flex-1">{{ c.name }}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            :class="c.isPublic ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'">
            {{ c.isPublic ? '公开' : '审核' }}
          </span>
          <span v-if="statusLabel(c)" class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
            {{ statusLabel(c) }}
          </span>
        </div>
        <p class="text-xs text-slate-400 line-clamp-2 mt-1.5 min-h-[2rem]">{{ c.description || '这个圈子还没有简介' }}</p>
        <div class="text-[10px] text-slate-400 mt-2">👥 {{ c.memberCount }} 位成员</div>
      </button>
    </div>

    <!-- 建圈弹窗 -->
    <Modal :show="showCreate" title="创建圈子" @close="showCreate = false">
      <div class="space-y-3">
        <div>
          <div class="label">圈子名称（1-30 字）</div>
          <input v-model="createName" maxlength="30" class="input" placeholder="如：高数冲刺组 / 2027 计算机统考" />
        </div>
        <div>
          <div class="label">圈子简介（可选，≤200 字）</div>
          <textarea v-model="createDesc" rows="3" maxlength="200" class="input" placeholder="这个圈子聊什么？"></textarea>
        </div>
        <div>
          <div class="label">加入方式</div>
          <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs w-fit">
            <button class="px-3 py-1.5 rounded-md transition-colors"
              :class="createPublic ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
              @click="createPublic = true">🌐 公开（直接加入）</button>
            <button class="px-3 py-1.5 rounded-md transition-colors"
              :class="!createPublic ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
              @click="createPublic = false">🔒 审核（圈主批准）</button>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="showCreate = false">取消</button>
        <button class="btn-primary" :disabled="creating" @click="submitCreate">{{ creating ? '创建中…' : '创建' }}</button>
      </template>
    </Modal>
  </div>
</template>
