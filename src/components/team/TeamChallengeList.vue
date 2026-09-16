<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { formatMinutes } from '../../utils/date'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { deleteChallenge, cancelChallenge, resumeChallenge } from '../../api/teams'
import { TYPE_LABEL, TYPE_UNIT, STATUS_LABEL, challengeStatus } from '../../utils/teamChallengeMeta'
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
  'auto-sync': []
}>()

const toast = useToast()
const confirm = useConfirm()

const manageSubmitting = ref<Record<string, boolean>>({})

/** 进入详情自动同步进行中的挑战（静默）：页面在首次 loadDetail 完成后渲染本组件，此处上抛意图由页面执行。
 *  非成员（未登录 / 未加入）无同步权限，不上抛意图，避免必然 403 的静默请求。 */
onMounted(() => {
  if (isMember.value) emit('auto-sync')
})

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

    <div v-if="!challenges.length" class="text-center text-sm text-slate-400 py-6">暂无挑战</div>

    <div v-else class="space-y-3">
      <div v-for="c in challenges" :key="c.id" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-semibold">{{ TYPE_LABEL[c.type] }}</span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded-full"
            :class="
              challengeStatus(c) === 'active'
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                : challengeStatus(c) === 'completed'
                  ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                  : challengeStatus(c) === 'cancelled'
                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
            "
          >
            {{ STATUS_LABEL[challengeStatus(c)] }}
          </span>
        </div>
        <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">
          目标 {{ c.target }} {{ TYPE_UNIT[c.type]
          }}<template v-if="c.type === 'minutes' && c.target >= 60">（{{ formatMinutes(c.target) }}）</template> ·
          {{ c.startDate }} ~ {{ c.endDate }}
        </div>
        <div class="mt-2">
          <template v-if="isMember">
            <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1">
              <span>我的进度 {{ c.myProgress }}/{{ c.target }}</span>
              <span v-if="c.myCompleted" class="text-emerald-500">已达标</span>
            </div>
            <div class="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary-500 rounded-full"
                :style="{ width: Math.min(100, Math.round((c.myProgress / c.target) * 100)) + '%' }"
              ></div>
            </div>
          </template>
          <p v-else class="text-xs text-slate-400">加入小组后可同步进度</p>
        </div>
        <div class="flex items-center justify-between mt-2">
          <span class="text-[10px] text-slate-400">团队达标 {{ c.completedCount }}/{{ memberCount }} 人</span>
          <div class="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              v-if="isMember && challengeStatus(c) === 'active'"
              class="btn-ghost !text-xs"
              :disabled="syncSubmitting[c.id]"
              @click="emit('sync', c)"
            >
              {{ syncSubmitting[c.id] ? '同步中…' : '同步进度' }}
            </button>
            <template v-if="myRole === 'leader'">
              <button
                v-if="challengeStatus(c) === 'upcoming' || challengeStatus(c) === 'active'"
                class="btn-ghost !text-xs"
                @click="emit('edit', c)"
              >
                编辑
              </button>
              <button
                v-if="challengeStatus(c) === 'active'"
                class="btn-ghost !text-xs !text-amber-500"
                :disabled="manageSubmitting[c.id]"
                @click="handleCancel(c)"
              >
                取消
              </button>
              <button
                v-if="challengeStatus(c) === 'cancelled'"
                class="btn-ghost !text-xs !text-emerald-500"
                :disabled="manageSubmitting[c.id]"
                @click="handleResume(c)"
              >
                恢复
              </button>
              <button
                class="btn-ghost !text-xs !text-red-500"
                :disabled="manageSubmitting[c.id]"
                @click="handleDelete(c)"
              >
                删除
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
