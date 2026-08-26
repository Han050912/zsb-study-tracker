<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTeamDetail, joinTeam, leaveTeam, transferLeader, disbandTeam, removeTeamMember, applyTeam, getTeamRequests, approveRequest, rejectRequest, withdrawRequest, resetInviteCode, updateTeam, createChallenge, syncChallengeProgress, updateChallenge, deleteChallenge, cancelChallenge, resumeChallenge } from '../api/teams'
import type { ChallengeType, TeamChallenge, TeamDetail, TeamMember, TeamJoinRequest } from '../types'
import { Crown, UserMinus, Flame, Timer, BookOpen } from '@lucide/vue'
import Modal from '../components/Modal.vue'
import UserAvatar from '../components/community/UserAvatar.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
import { useBack } from '../composables/useBack'

const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})
const teamId = route.params.id as string

const inviteInput = ref(typeof route.query.invite === 'string' ? route.query.invite : '')
const applySubmitting = ref(false)
const withdrawing = ref(false)
const resettingCode = ref(false)
const requests = ref<TeamJoinRequest[]>([])
const reviewing = ref<Record<string, boolean>>({})
const rejectTarget = ref<TeamJoinRequest | null>(null)
const rejectReason = ref('')
const rejectSubmitting = ref(false)

const showEdit = ref(false)
const teamEditForm = ref({ name: '', description: '', maxMembers: 10 })
const teamEditSubmitting = ref(false)

const editMinMembers = computed(() => Math.max(2, detail.value?.members.length ?? 2))
const editInvalid = computed(() => teamEditForm.value.maxMembers < (detail.value?.members.length ?? 0))

const detail = ref<TeamDetail | null>(null)
const loading = ref(true)
const joinSubmitting = ref(false)
const leaveSubmitting = ref(false)
const transferSubmitting = ref(false)

const showProfile = ref(false)
const profileUserId = ref('')
const kickTarget = ref<TeamMember | null>(null)
const kickSubmitting = ref(false)
const showLeaveModal = ref(false)
const leaveMode = ref<'disband' | 'transfer'>('disband')
const transferTargetId = ref('')
const leaderLeaveSubmitting = ref(false)

function openProfile(userId: string) {
  profileUserId.value = userId
  showProfile.value = true
}

function openKick(m: TeamMember) {
  kickTarget.value = m
}

async function handleKick() {
  if (!kickTarget.value || kickSubmitting.value) return
  kickSubmitting.value = true
  try {
    await removeTeamMember(teamId, kickTarget.value.userId)
    toast('已踢出')
    kickTarget.value = null
    await loadDetail()
  } catch (e: any) { toast(e?.message || '踢出失败') }
  finally { kickSubmitting.value = false }
}

async function handleApply() {
  if (!inviteInput.value.trim() || applySubmitting.value) return
  applySubmitting.value = true
  try {
    await applyTeam(teamId, inviteInput.value.trim())
    toast('申请已提交，等待队长审核')
    inviteInput.value = ''
    await loadDetail()
  } catch (e: any) { toast(e?.message || '申请失败') }
  finally { applySubmitting.value = false }
}

async function handleWithdraw() {
  if (withdrawing.value) return
  withdrawing.value = true
  try {
    await withdrawRequest(teamId)
    toast('已撤回申请')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '撤回失败') }
  finally { withdrawing.value = false }
}

async function loadRequests() {
  if (team.value?.myRole !== 'leader') return
  try { requests.value = await getTeamRequests(teamId) } catch {}
}

async function handleApprove(r: TeamJoinRequest) {
  if (reviewing.value[r.userId]) return
  reviewing.value[r.userId] = true
  try {
    await approveRequest(teamId, r.userId)
    toast('已同意')
    await Promise.all([loadDetail(), loadRequests()])
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { reviewing.value[r.userId] = false }
}

function openReject(r: TeamJoinRequest) {
  rejectTarget.value = r
  rejectReason.value = ''
}

async function handleReject() {
  if (!rejectTarget.value || rejectSubmitting.value) return
  rejectSubmitting.value = true
  try {
    await rejectRequest(teamId, rejectTarget.value.userId, rejectReason.value.trim() || undefined)
    toast('已拒绝')
    rejectTarget.value = null
    await Promise.all([loadDetail(), loadRequests()])
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { rejectSubmitting.value = false }
}

async function handleResetCode() {
  if (resettingCode.value) return
  if (!window.confirm('确认重新生成邀请码？旧邀请码将立即失效。')) return
  resettingCode.value = true
  try {
    await resetInviteCode(teamId)
    toast('邀请码已重置')
    await loadDetail()
  } catch (e: any) { toast(e?.message || '重置失败') }
  finally { resettingCode.value = false }
}

async function copyInvite() {
  if (!detail.value?.inviteCode) return
  try {
    await navigator.clipboard.writeText(detail.value.inviteCode)
    toast('邀请码已复制')
  } catch { toast('复制失败，请手动复制') }
}

function openTeamEdit() {
  if (!team.value) return
  teamEditForm.value = { name: team.value.name, description: team.value.description, maxMembers: team.value.maxMembers }
  showEdit.value = true
}

async function handleTeamEdit() {
  if (teamEditSubmitting.value || editInvalid.value) return
  if (!teamEditForm.value.name.trim()) { toast('请输入小组名称'); return }
  teamEditSubmitting.value = true
  try {
    await updateTeam(teamId, teamEditForm.value)
    toast('已保存')
    showEdit.value = false
    await loadDetail()
  } catch (e: any) { toast(e?.message || '保存失败') }
  finally { teamEditSubmitting.value = false }
}

const team = computed(() => detail.value?.team ?? null)

onMounted(async () => {
  await loadDetail()
  await autoSync()
})

async function loadDetail() {
  loading.value = true
  try {
    detail.value = await getTeamDetail(teamId)
    await loadRequests()
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
    toast('已加入小组')
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

async function handleLeaderLeave() {
  if (leaderLeaveSubmitting.value) return
  if (leaveMode.value === 'transfer' && !transferTargetId.value) { toast('请选择接任队长'); return }
  leaderLeaveSubmitting.value = true
  try {
    if (leaveMode.value === 'disband') {
      await disbandTeam(teamId)
      toast('小组已解散')
    } else {
      await transferLeader(teamId, transferTargetId.value)
      await leaveTeam(teamId)
      toast('已退出小组')
    }
    router.replace('/teams')
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { leaderLeaveSubmitting.value = false }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---- 挑战 ----
const TYPE_LABEL: Record<ChallengeType, string> = { streak: '连续打卡', minutes: '学习时长', problems: '刷题数' }
const TYPE_UNIT: Record<ChallengeType, string> = { streak: '天', minutes: '分钟', problems: '题' }
/** 各挑战类型的图标 / 说明 / 快捷预设 / 占位提示，让目标值与单位一一对应，避免三种类型混用同一输入框 */
const TYPE_META: Record<ChallengeType, { icon: any; desc: string; presets: number[]; placeholder: string }> = {
  streak: { icon: Flame, desc: '坚持每日打卡', presets: [7, 14, 21, 30], placeholder: '如 7' },
  minutes: { icon: Timer, desc: '累计专注时长', presets: [60, 120, 300, 600], placeholder: '如 120' },
  problems: { icon: BookOpen, desc: '累计刷题数量', presets: [50, 100, 200, 500], placeholder: '如 100' }
}
/** 分钟数人性化显示：不足 1 小时直接显示分钟，否则换算为「X 小时 Y 分」 */
function formatMinutes(m: number): string {
  if (!m || m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const min = m % 60
  return min ? `${h} 小时 ${min} 分` : `${h} 小时`
}
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
    if (!before && after?.isCompleted) toast('全员达标')
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
const editingType = ref<ChallengeType>('streak')
const editForm = ref({ target: 7, durationDays: 7, startDate: '' })
const editSubmitting = ref(false)
const manageSubmitting = ref<Record<string, boolean>>({})

function openEdit(c: TeamChallenge) {
  editingId.value = c.id
  editingType.value = c.type
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
      <button class="btn-ghost !px-2" @click="goBack">← 返回</button>

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
          <span>{{ team.memberCount }} / {{ team.maxMembers }} 人</span>
          <span>创建于 {{ formatDate(team.createdAt) }}</span>
          <div class="flex-1"></div>
          <template v-if="!team.myRole">
            <template v-if="!team.isPublic">
              <template v-if="detail?.myJoinRequest">
                <span class="text-xs text-amber-500">申请待审核</span>
                <button class="btn-ghost !text-xs" :disabled="withdrawing" @click="handleWithdraw">{{ withdrawing ? '撤回中…' : '撤回申请' }}</button>
              </template>
              <template v-else>
                <input v-model="inviteInput" type="text" placeholder="邀请码" maxlength="8" class="input !w-28 !text-xs !py-1" />
                <button class="btn-primary !text-xs" :disabled="applySubmitting" @click="handleApply">{{ applySubmitting ? '申请中…' : '申请加入' }}</button>
              </template>
            </template>
            <button v-else class="btn-primary !text-xs" :disabled="joinSubmitting" @click="handleJoin">
              {{ joinSubmitting ? '加入中…' : '加入小组' }}
            </button>
          </template>
          <button v-else-if="team.myRole === 'member'" class="btn-ghost !text-xs !text-red-500" :disabled="leaveSubmitting" @click="handleLeave">
            {{ leaveSubmitting ? '退出中…' : '退出小组' }}
          </button>
          <template v-else-if="team.myRole === 'leader'">
            <button class="btn-ghost !text-xs" @click="openTeamEdit">编辑</button>
            <button class="btn-ghost !text-xs !text-red-500" @click="showLeaveModal = true">退出小组</button>
          </template>
        </div>
        <div v-if="team.myRole === 'leader' && !team.isPublic && detail?.inviteCode" class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <div class="label !mb-1">邀请码</div>
          <div class="flex items-center gap-2 flex-wrap">
            <code class="text-sm font-mono tracking-widest">{{ detail.inviteCode }}</code>
            <button class="btn-ghost !text-xs" @click="copyInvite">复制</button>
            <button class="btn-ghost !text-xs" :disabled="resettingCode" @click="handleResetCode">{{ resettingCode ? '重置中…' : '重置' }}</button>
            <span v-if="detail.inviteCodeExpiresAt" class="text-[10px] text-slate-400">有效期至 {{ formatDate(detail.inviteCodeExpiresAt) }}</span>
          </div>
        </div>
      </div>

      <div v-if="detail?.members.length" class="card">
        <div class="label !mb-2">成员（{{ detail.members.length }}）</div>
        <div class="divide-y divide-slate-100 dark:divide-slate-700">
          <div v-for="m in detail.members" :key="m.userId" class="flex items-center gap-3 py-2">
            <button class="shrink-0" @click="openProfile(m.userId)">
              <UserAvatar :name="m.userName" :avatar="m.userAvatar" size="sm" />
            </button>
            <button class="text-sm flex-1 min-w-0 truncate text-left hover:text-primary-500" @click="openProfile(m.userId)">
              {{ m.userName }}
            </button>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              :class="m.role === 'leader' ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'">
              {{ m.role === 'leader' ? '队长' : '成员' }}
            </span>
            <div v-if="team.myRole === 'leader' && m.role === 'member'" class="flex items-center gap-1.5 shrink-0">
              <button class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 transition-colors hover:text-primary-500 hover:border-primary-300"
                :disabled="transferSubmitting" @click="handleTransfer(m.userId, m.userName)">
                <Crown class="w-3.5 h-3.5" />设为队长
              </button>
              <button class="inline-flex items-center gap-1 rounded-full border border-red-200 dark:border-red-900/50 px-2.5 py-1 text-xs text-red-500 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                @click="openKick(m)">
                <UserMinus class="w-3.5 h-3.5" />踢出
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="team.myRole === 'leader' && requests.length" class="card">
        <div class="label !mb-2">待审核申请（{{ requests.length }}）</div>
        <div class="divide-y divide-slate-100 dark:divide-slate-700">
          <div v-for="r in requests" :key="r.userId" class="flex items-center gap-3 py-2">
            <UserAvatar :name="r.userName" :avatar="r.userAvatar" size="sm" />
            <button class="text-sm flex-1 min-w-0 truncate text-left hover:text-primary-500" @click="openProfile(r.userId)">{{ r.userName }}</button>
            <button class="btn-primary !text-xs" :disabled="reviewing[r.userId]" @click="handleApprove(r)">同意</button>
            <button class="btn-ghost !text-xs !text-red-500" :disabled="reviewing[r.userId]" @click="openReject(r)">拒绝</button>
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
              目标 {{ c.target }} {{ TYPE_UNIT[c.type] }}<template v-if="c.type === 'minutes' && c.target >= 60">（{{ formatMinutes(c.target) }}）</template> · {{ c.startDate }} ~ {{ c.endDate }}
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
        <div class="grid grid-cols-3 gap-2">
          <button v-for="t in (['streak', 'minutes', 'problems'] as ChallengeType[])" :key="t"
            class="flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition-colors"
            :class="createForm.type === t
              ? 'border-primary-400 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
              : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'"
            @click="createForm.type = t">
            <component :is="TYPE_META[t].icon" class="w-5 h-5" />
            <span class="text-xs font-semibold">{{ TYPE_LABEL[t] }}</span>
            <span class="text-[10px] opacity-70">{{ TYPE_META[t].desc }}</span>
          </button>
        </div>
      </div>
      <div>
        <div class="label">{{ TYPE_LABEL[createForm.type] }}目标（{{ TYPE_UNIT[createForm.type] }}）</div>
        <div class="flex items-center gap-2">
          <input v-model.number="createForm.target" type="number" min="1" max="10000" class="input flex-1"
            :placeholder="TYPE_META[createForm.type].placeholder" />
          <span class="text-sm text-slate-500 dark:text-slate-400 shrink-0">{{ TYPE_UNIT[createForm.type] }}</span>
        </div>
        <p v-if="createForm.type === 'minutes' && createForm.target >= 60" class="text-xs text-slate-400 mt-1">
          约 {{ formatMinutes(createForm.target) }}
        </p>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <button v-for="p in TYPE_META[createForm.type].presets" :key="p"
            class="px-2.5 py-1 rounded-full text-xs border transition-colors"
            :class="createForm.target === p
              ? 'border-primary-400 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
              : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'"
            @click="createForm.target = p">
            {{ p }}{{ TYPE_UNIT[createForm.type] }}
          </button>
        </div>
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
        <div class="label">{{ TYPE_LABEL[editingType] }}目标（{{ TYPE_UNIT[editingType] }}）</div>
        <div class="flex items-center gap-2">
          <input v-model.number="editForm.target" type="number" min="1" max="10000" class="input flex-1" />
          <span class="text-sm text-slate-500 dark:text-slate-400 shrink-0">{{ TYPE_UNIT[editingType] }}</span>
        </div>
        <p v-if="editingType === 'minutes' && editForm.target >= 60" class="text-xs text-slate-400 mt-1">
          约 {{ formatMinutes(editForm.target) }}
        </p>
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

  <Modal :show="!!kickTarget" title="踢出成员" @close="kickTarget = null">
    <p class="text-sm text-slate-500 dark:text-slate-400">
      确认将「{{ kickTarget?.userName }}」踢出小组？其将被移出并收到通知。
    </p>
    <template #footer>
      <button class="btn-ghost" @click="kickTarget = null">取消</button>
      <button class="btn-danger" :disabled="kickSubmitting" @click="handleKick">{{ kickSubmitting ? '踢出中…' : '踢出' }}</button>
    </template>
  </Modal>

  <Modal :show="!!rejectTarget" title="拒绝申请" @close="rejectTarget = null">
    <div class="space-y-3">
      <p class="text-sm text-slate-500 dark:text-slate-400">拒绝「{{ rejectTarget?.userName }}」的加入申请？</p>
      <input v-model="rejectReason" type="text" maxlength="200" placeholder="拒绝原因（可选）" class="input" />
    </div>
    <template #footer>
      <button class="btn-ghost" @click="rejectTarget = null">取消</button>
      <button class="btn-danger" :disabled="rejectSubmitting" @click="handleReject">{{ rejectSubmitting ? '拒绝中…' : '拒绝' }}</button>
    </template>
  </Modal>

  <Modal :show="showEdit" title="编辑小组信息" @close="showEdit = false">
    <div class="space-y-3">
      <div>
        <div class="label">小组名称（1-30 字）</div>
        <input v-model="teamEditForm.name" type="text" maxlength="30" class="input" />
      </div>
      <div>
        <div class="label">小组描述（0-200 字）</div>
        <textarea v-model="teamEditForm.description" maxlength="200" rows="3" class="input"></textarea>
      </div>
      <div>
        <div class="label">人数上限</div>
        <input v-model.number="teamEditForm.maxMembers" type="number" :min="editMinMembers" max="50" class="input" />
        <p v-if="editInvalid" class="text-xs text-red-500 mt-1">不能低于当前成员数（{{ detail?.members.length }} 人）</p>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showEdit = false">取消</button>
      <button class="btn-primary" :disabled="teamEditSubmitting || editInvalid" @click="handleTeamEdit">{{ teamEditSubmitting ? '保存中…' : '保存' }}</button>
    </template>
  </Modal>

  <Modal :show="showLeaveModal" title="退出小组" @close="showLeaveModal = false">
    <div class="space-y-3">
      <button class="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 transition-colors"
        :class="leaveMode === 'disband' ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10' : 'hover:border-slate-300'"
        @click="leaveMode = 'disband'">
        <div class="text-sm font-semibold text-red-500">解散小队</div>
        <div class="text-xs text-slate-400 mt-0.5">解散后小组与全部挑战将被删除，不可撤销</div>
      </button>

      <button class="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 transition-colors"
        :class="leaveMode === 'transfer' ? 'border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10' : 'hover:border-slate-300'"
        @click="leaveMode = 'transfer'">
        <div class="text-sm font-semibold">转让队长并退出</div>
        <div class="text-xs text-slate-400 mt-0.5">选一名成员接任队长，你将退出小组</div>
      </button>

      <div v-if="leaveMode === 'transfer'" class="space-y-1 pt-1">
        <div class="label !mb-1">选择接任队长</div>
        <div v-for="m in detail?.members.filter(x => x.role === 'member')" :key="m.userId"
          class="flex items-center gap-2 py-1.5 cursor-pointer" @click="transferTargetId = m.userId">
          <span class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
            :class="transferTargetId === m.userId ? 'border-primary-500' : 'border-slate-300 dark:border-slate-600'">
            <span v-if="transferTargetId === m.userId" class="w-2 h-2 rounded-full bg-primary-500"></span>
          </span>
          <UserAvatar :name="m.userName" :avatar="m.userAvatar" size="sm" />
          <span class="text-sm truncate">{{ m.userName }}</span>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showLeaveModal = false">取消</button>
      <button class="btn-primary" :disabled="leaderLeaveSubmitting || (leaveMode === 'transfer' && !transferTargetId)"
        @click="handleLeaderLeave">
        {{ leaderLeaveSubmitting ? '处理中…' : '确认' }}
      </button>
    </template>
  </Modal>

  <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
</template>
