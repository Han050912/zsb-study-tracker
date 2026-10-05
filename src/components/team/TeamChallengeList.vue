<script setup lang="ts">
import CompanionProgress from './CompanionProgress.vue'
import EmptyState from '../../shared/components/EmptyState.vue'
import { computed, ref } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { deleteChallenge, cancelChallenge, resumeChallenge } from '../../api/teams'
import { challengeStatus } from '../../utils/teamChallengeMeta'
import type { TeamChallenge } from '../../types'

/**
 * 挑战卡：列表展示 + 队长管理（取消/恢复/删除就地执行后 emit refresh）；
 * 同步与自动同步只发意图（sync / auto-sync），before/after 比较与 toast 留页面层；
 * 「我的进度」与「同步进度」仅成员（myRole 为 leader/member）可见，非成员改为提示文案
 */
const props = defineProps<{
  challenges: TeamChallenge[]
  memberCount: number
  myRole?: 'leader' | 'member'
  syncSubmitting: Record<string, boolean>
}>()

/** 成员判定唯一来源：详情接口返回的 myRole（leader/member 为成员；未登录与非成员均为 undefined） */
const isMember = computed(() => !!props.myRole)

const emit = defineEmits<{
  sync: [challenge: TeamChallenge]
  create: []
  edit: [challenge: TeamChallenge]
  refresh: []
}>()

const toast = useToast()
const confirm = useConfirm()

const manageSubmitting = ref<Record<string, boolean>>({})

/** 进入详情自动同步进行中的挑战（静默）：页面在首次 loadDetail 完成后渲染本组件，此处上抛意图由页面执行。
 *  非成员（未登录 / 未加入）无同步权限，不上抛意图，避免必然 403 的静默请求。 */

async function handleDelete(c: TeamChallenge) {
  if (manageSubmitting.value[c.id]) return
  if (!(await confirm('确认删除该挑战？所有成员进度将一并删除。', { danger: true }))) return
  manageSubmitting.value[c.id] = true
  try {
    await deleteChallenge(c.id)
    toast('挑战已删除')
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '删除失败'))
  } finally {
    manageSubmitting.value[c.id] = false
  }
}

async function handleCancel(c: TeamChallenge) {
  if (manageSubmitting.value[c.id]) return
  if (!(await confirm('确认取消该挑战？取消后将暂停进度同步。'))) return
  manageSubmitting.value[c.id] = true
  try {
    await cancelChallenge(c.id)
    toast('挑战已取消')
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '取消失败'))
  } finally {
    manageSubmitting.value[c.id] = false
  }
}

async function handleResume(c: TeamChallenge) {
  if (manageSubmitting.value[c.id]) return
  manageSubmitting.value[c.id] = true
  try {
    await resumeChallenge(c.id)
    toast('挑战已恢复')
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '恢复失败'))
  } finally {
    manageSubmitting.value[c.id] = false
  }
}
</script>

<template>
  <div class="card">
    <div class="flex items-center gap-2 mb-2">
      <div class="label !mb-0">挑战（{{ challenges.length }}）</div>
      <div class="flex-1"></div>
      <button v-if="myRole === 'leader'" class="btn-ghost !text-xs" @click="emit('create')">＋ 创建挑战</button>
    </div>

    <EmptyState v-if="!challenges.length" title="还没有挑战。队长可以约定学习时长、做题量或连续打卡目标。" />

    <div v-else class="space-y-3">
      <div v-for="c in challenges" :key="c.id" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3">
        <CompanionProgress :challenge="c" :member-count="memberCount" :show-mine="isMember" />
        <div class="flex flex-wrap items-center justify-end mt-4">
          <div class="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              v-if="isMember && challengeStatus(c) === 'active'"
              class="btn-ghost !text-xs"
              :disabled="syncSubmitting[c.id]"
              @click="emit('sync', c)"
            >
              {{ syncSubmitting[c.id] ? '同步中…' : '同步进度' }}
            </button>
            <details v-if="myRole === 'leader'" class="relative">
              <summary class="btn-ghost cursor-pointer">管理</summary>
              <div class="absolute right-0 z-10 card !p-2 w-32 flex flex-col">
                <button
                  v-if="challengeStatus(c) === 'upcoming' || challengeStatus(c) === 'active'"
                  class="btn-ghost !text-xs"
                  @click="emit('edit', c)"
                >
                  编辑
                </button>
                <button
                  v-if="challengeStatus(c) === 'active'"
                  class="btn-ghost !text-xs !text-action"
                  :disabled="manageSubmitting[c.id]"
                  @click="handleCancel(c)"
                >
                  取消
                </button>
                <button
                  v-if="challengeStatus(c) === 'cancelled'"
                  class="btn-ghost !text-xs !text-action"
                  :disabled="manageSubmitting[c.id]"
                  @click="handleResume(c)"
                >
                  恢复
                </button>
                <button
                  class="btn-ghost !text-xs !text-correction"
                  :disabled="manageSubmitting[c.id]"
                  @click="handleDelete(c)"
                >
                  删除
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
