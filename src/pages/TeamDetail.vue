<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTeamDetail, joinTeam, leaveTeam, transferLeader, disbandTeam, createChallenge, syncChallengeProgress, updateChallenge, deleteChallenge, cancelChallenge, resumeChallenge } from '../api/teams'
import type { ChallengeType, TeamChallenge, TeamDetail } from '../types'
import Modal from '../components/Modal.vue'

const route = useRoute()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})
const teamId = route.params.id as string

const detail = ref<TeamDetail | null>(null)
const loading = ref(true)
const joinSubmitting = ref(false)
const leaveSubmitting = ref(false)
const transferSubmitting = ref(false)
const disbandSubmitting = ref(false)

const team = computed(() => detail.value?.team ?? null)

onMounted(async () => {
  await loadDetail()
  await autoSync()
})

async function loadDetail() {
  loading.value = true
  try {
    detail.value = await getTeamDetail(teamId)
  } catch (e: any) {
    toast(e?.message || '小组不存在')
    router.replace('/teams')
  } finally {
    loading.value = false
  }
}

async function handleJoin() {
  if (!team.value || joinSubmitting.value) return
  joinSubmitting.value = true
  try {
    await joinTeam(teamId)
    toast('已加入小组 🎉')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '加入失败') }
  finally { joinSubmitting.value = false }
}

async function handleLeave() {
  if (!team.value || leaveSubmitting.value) return
  if (!window.confirm('确认退出该小组？')) return
  leaveSubmitting.value = true
  try {
    await leaveTeam(teamId)
    toast('已退出小组')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '退出失败') }
  finally { leaveSubmitting.value = false }
}

async function handleTransfer(userId: string, name: string) {
  if (transferSubmitting.value) return
  if (!window.confirm(`确认将队长转让给 ${name}？`)) return
  transferSubmitting.value = true
  try {
    await transferLeader(teamId, userId)
    toast('已转让队长')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '转让失败') }
  finally { transferSubmitting.value = false }
}

async function handleDisband() {
  if (disbandSubmitting.value) return
  if (!window.confirm('确认解散该小组？此操作不可撤销，组内挑战与进度将被删除。')) return
  disbandSubmitting.value = true
  try {
    await disbandTeam(teamId)
    toast('小组已解散')
    router.replace('/teams')
  } catch (e: any) { toast(e?.message || '解散失败') }
  finally { disbandSubmitting.value = false }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---- 挑战 ----
const TYPE_LABEL: Record<ChallengeType, string> = { streak: '连续打卡', minutes: '学习时长', problems: '刷题数' }
const TYPE_UNIT: Record<ChallengeType, string> = { streak: '天', minutes: '分钟', problems: '题' }
const STATUS_LABEL = { upcoming: '未开始', active: '进行中', cancelled: '已取消', completed: '全员达标', ended: '已结束' } as const
type ChallengeStatus = keyof typeof STATUS_LABEL

function todayUtc8(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function challengeStatus(c: TeamChallenge): ChallengeStatus {
  if (c.isCancelled) return 'cancelled'
  if (c.isCompleted) return 'completed'
  const t = todayUtc8()
  if (t < c.startDate) return 'upcoming'
  if (t > c.endDate) return 'ended'
  return 'active'
}

const syncSubmitting = ref<Record<string, boolean>>({})

async function syncChallenge(c: TeamChallenge) {
  if (syncSubmitting.value[c.id]) return
  syncSubmitting.value[c.id] = true
  try {
    await syncChallengeProgress(c.id)
    const before = c.isCompleted
    await loadDetail()
    const after = detail.value?.challenges.find(x => x.id === c.id)
    if (!before && after?.isCompleted) toast('🎉 全员达标')
  } catch (e: any) {
    toast(e?.message || '同步失败')
  } finally {
    syncSubmitting.value[c.id] = false
  }
}

/** 进入详情自动同步进行中的挑战（静默） */
async function autoSync() {
  const actives = detail.value?.challenges.filter(c => challengeStatus(c) === 'active') ?? []
  await Promise.all(actives.map(c => syncChallengeProgress(c.id).catch(() => {})))
  if (actives.length) await loadDetail()
}

const showCreate = ref(false)
const createForm = ref({ type: 'streak' as ChallengeType, target: 7, durationDays: 7, startDate: todayUtc8() })
const creating = ref(false)

async function handleCreate() {
  if (creating.value) return
  creating.value = true
  try {
    await createChallenge(teamId, createForm.value)
    toast('挑战已创建')
    showCreate.value = false
    createForm.value = { type: 'streak', target: 7, durationDays: 7, startDate: todayUtc8() }
    await loadDetail()
  } catch (e: any) { toast(e?.message || '创建失败') }
  finally { creating.value = false }
}

// ---- 挑战管理（仅队长） ----
const editingId = ref<string | null>(null)
const editForm = ref({ target: 7, durationDays: 7, startDate: '' })
const editSubmitting = ref(false)
const manageSubmitting = ref<Record<string, boolean>>({})

function openEdit(c: TeamChallenge) {
  editingId.value = c.id
  editForm.value = { target: c.target, durationDays: c.durationDays, startDate: c.startDate }
}

async function handleEdit() {
  if (!editingId.value || editSubmitting.value) return
  editSubmitting.value = true
  try {
    await updateChallenge(editingId.value, editForm.value)
    toast('挑战已更新')
    editingId.value = null
    await loadDetail()
  } catch (e: any) { toast(e?.message || '更新失败') }
  finally { editSubmitting.value = false }
}

async function handleDelete(c: TeamChallenge) {
  if (manageSubmitting.value[c.id]) return
  if (!window.confirm('确认删除该挑战？所有成员进度将一并删除。')) return
  manageSubmitting.value[c.id] = true
  try {
    await deleteChallenge(c.id)
    toast('挑战已删除')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '删除失败') }
  finally { manageSubmitting.value[c.id] = false }
}

async function handleCancel(c: TeamChallenge) {
  if (manageSubmitting.value[c.id]) return
  if (!window.confirm('确认取消该挑战？取消后将暂停进度同步。')) return
  manageSubmitting.value[c.id] = true
  try {
    await cancelChallenge(c.id)
    toast('挑战已取消')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '取消失败') }
  finally { manageSubmitting.value[c.id] = false }
}

async function handleResume(c: TeamChallenge) {
  if (manageSubmitting.value[c.id]) return
  manageSubmitting.value[c.id] = true
  try {
    await resumeChallenge(c.id)
    toast('挑战已恢复')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '恢复失败') }
  finally { manageSubmitting.value[c.id] = false }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-4">
    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>

    <template v-else-if="team">
      <button class="btn-ghost !px-2" @click="router.push('/teams')">← 组队挑战列表</button>

      <div class="card space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-lg font-bold flex-1 min-w-0 truncate">{{ team.name }}</h2>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            :class="team.isPublic ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'">
            {{ team.isPublic ? '公开' : '私密' }}
          </span>
          <span v-if="team.myRole === 'leader'" class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400">队长</span>
          <span v-else-if="team.myRole === 'member'" class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">成员</span>
        </div>
        <p v-if="team.description" class="text-sm text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{{ team.description }}</p>
        <div class="flex items-center gap-3 text-xs text-slate-400">
          <span>👥 {{ team.memberCount }}/{{ team.maxMembers }} 人</span>
          <span>创建于 {{ formatDate(team.createdAt) }}</span>
          <div class="flex-1"></div>
          <button v-if="!team.myRole" class="btn-primary !text-xs" :disabled="joinSubmitting" @click="handleJoin">
            {{ joinSubmitting ? '加入中…' : '加入小组' }}
          </button>
          <button v-else-if="team.myRole === 'member'" class="btn-ghost !text-xs !text-red-500" :disabled="leaveSubmitting" @click="handleLeave">
            {{ leaveSubmitting ? '退出中…' : '退出小组' }}
          </button>
          <button v-else-if="team.myRole === 'leader'" class="btn-danger !text-xs" :disabled="disbandSubmitting" @click="handleDisband">
            {{ disbandSubmitting ? '解散中…' : '解散小组' }}
          </button>
        </div>
      </div>

      <div v-if="detail?.members.length" class="card">
        <div class="label !mb-2">成员（{{ detail.members.length }}）</div>
        <div class="flex flex-wrap gap-3">
          <div v-for="m in detail.members" :key="m.userId" class="flex items-center gap-1.5">
            <span class="text-xs">{{ m.userName }}</span>
            <span v-if="m.role === 'leader'" class="text-[10px] text-yellow-500">队长</span>
            <button v-if="team.myRole === 'leader' && m.role === 'member'"
              class="text-[10px] text-slate-300 hover:text-blue-500" :disabled="transferSubmitting"
              @click="handleTransfer(m.userId, m.userName)">设为队长</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-2 mb-2">
          <div class="label !mb-0">挑战（{{ detail?.challenges.length }}）</div>
          <div class="flex-1"></div>
          <button v-if="team.myRole === 'leader'" class="btn-ghost !text-xs" @click="showCreate = true">＋ 创建挑战</button>
        </div>

        <div v-if="!detail?.challenges.length" class="text-center text-sm text-slate-400 py-6">暂无挑战</div>

        <div v-else class="space-y-3">
          <div v-for="c in detail.challenges" :key="c.id" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold">{{ TYPE_LABEL[c.type] }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full"
                :class="challengeStatus(c) === 'active' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                  : challengeStatus(c) === 'completed' ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                  : challengeStatus(c) === 'cancelled' ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'">
                {{ STATUS_LABEL[challengeStatus(c)] }}
              </span>
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">
              目标 {{ c.target }} {{ TYPE_UNIT[c.type] }} · {{ c.startDate }} ~ {{ c.endDate }}
            </div>
            <div class="mt-2">
              <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span>我的进度 {{ c.myProgress }}/{{ c.target }}</span>
                <span v-if="c.myCompleted" class="text-emerald-500">已达标</span>
              </div>
              <div class="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div class="h-full bg-primary-500 rounded-full" :style="{ width: Math.min(100, Math.round(c.myProgress / c.target * 100)) + '%' }"></div>
              </div>
            </div>
            <div class="flex items-center justify-between mt-2">
              <span class="text-[10px] text-slate-400">团队达标 {{ c.completedCount }}/{{ detail.members.length }} 人</span>
              <div class="flex items-center gap-1.5 flex-wrap justify-end">
                <button v-if="challengeStatus(c) === 'active'" class="btn-ghost !text-xs" :disabled="syncSubmitting[c.id]" @click="syncChallenge(c)">
                  {{ syncSubmitting[c.id] ? '同步中…' : '同步进度' }}
                </button>
                <template v-if="team.myRole === 'leader'">
                  <button v-if="challengeStatus(c) === 'upcoming' || challengeStatus(c) === 'active'" class="btn-ghost !text-xs" @click="openEdit(c)">编辑</button>
                  <button v-if="challengeStatus(c) === 'active'" class="btn-ghost !text-xs !text-amber-500" :disabled="manageSubmitting[c.id]" @click="handleCancel(c)">取消</button>
                  <button v-if="challengeStatus(c) === 'cancelled'" class="btn-ghost !text-xs !text-emerald-500" :disabled="manageSubmitting[c.id]" @click="handleResume(c)">恢复</button>
                  <button class="btn-ghost !text-xs !text-red-500" :disabled="manageSubmitting[c.id]" @click="handleDelete(c)">删除</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>

  <Modal :show="showCreate" title="创建挑战" @close="showCreate = false">
    <div class="space-y-3">
      <div>
        <div class="label">挑战类型</div>
        <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs w-fit">
          <button v-for="t in (['streak', 'minutes', 'problems'] as ChallengeType[])" :key="t"
            class="px-3 py-1.5 rounded-md transition-colors"
            :class="createForm.type === t ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
            @click="createForm.type = t">{{ TYPE_LABEL[t] }}</button>
        </div>
      </div>
      <div>
        <div class="label">目标值（1-10000）</div>
        <input v-model.number="createForm.target" type="number" min="1" max="10000" class="input" />
      </div>
      <div>
        <div class="label">挑战天数（1-90）</div>
        <input v-model.number="createForm.durationDays" type="number" min="1" max="90" class="input" />
      </div>
      <div>
        <div class="label">开始日期</div>
        <input v-model="createForm.startDate" type="date" class="input" />
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showCreate = false">取消</button>
      <button class="btn-primary" :disabled="creating" @click="handleCreate">{{ creating ? '创建中…' : '创建' }}</button>
    </template>
  </Modal>

  <Modal :show="!!editingId" title="编辑挑战" @close="editingId = null">
    <div class="space-y-3">
      <div>
        <div class="label">目标值（1-10000）</div>
        <input v-model.number="editForm.target" type="number" min="1" max="10000" class="input" />
      </div>
      <div>
        <div class="label">挑战天数（1-90）</div>
        <input v-model.number="editForm.durationDays" type="number" min="1" max="90" class="input" />
      </div>
      <div>
        <div class="label">开始日期</div>
        <input v-model="editForm.startDate" type="date" class="input" />
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="editingId = null">取消</button>
      <button class="btn-primary" :disabled="editSubmitting" @click="handleEdit">{{ editSubmitting ? '保存中…' : '保存' }}</button>
    </template>
  </Modal>
</template>
