<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useRoute, useRouter } from 'vue-router'
import {
  getTeamDetail,
  leaveTeam,
  transferLeader,
  disbandTeam,
  getTeamRequests,
  syncChallengeProgress
} from '../api/teams'
import type { TeamChallenge, TeamDetail, TeamMember, TeamJoinRequest } from '../types'
import { challengeStatus } from '../utils/teamChallengeMeta'
import TeamHeaderCard from '../components/team/TeamHeaderCard.vue'
import TeamMemberList from '../components/team/TeamMemberList.vue'
import TeamJoinRequestList from '../components/team/TeamJoinRequestList.vue'
import TeamChallengeList from '../components/team/TeamChallengeList.vue'
import ChallengeFormModal from '../components/team/ChallengeFormModal.vue'
import TeamEditModal from '../components/team/TeamEditModal.vue'
import KickConfirmModal from '../components/team/KickConfirmModal.vue'
import LeaderLeaveModal from '../components/team/LeaderLeaveModal.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
import { useBack } from '../composables/useBack'

const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const toast = useToast()
const confirm = useConfirm()
const teamId = route.params.id as string

const detail = ref<TeamDetail | null>(null)
const loading = ref(true)
const requests = ref<TeamJoinRequest[]>([])
const leaveSubmitting = ref(false)
const transferSubmitting = ref(false)

const showProfile = ref(false)
const profileUserId = ref('')
const kickTarget = ref<TeamMember | null>(null)
const showLeaveModal = ref(false)
const leaderLeaveSubmitting = ref(false)

const showEdit = ref(false)
const showCreate = ref(false)
const editingChallenge = ref<TeamChallenge | null>(null)

const team = computed(() => detail.value?.team ?? null)

function openProfile(userId: string) {
  profileUserId.value = userId
  showProfile.value = true
}

onMounted(async () => {
  await loadDetail()
})

async function loadDetail() {
  loading.value = true
  try {
    // 经邀请码跳转进入时透传 invite，私密小组详情接口据此放行非成员
    const invite = typeof route.query.invite === 'string' ? route.query.invite : undefined
    detail.value = await getTeamDetail(teamId, invite)
    await loadRequests()
  } catch (e) {
    toast(getErrorMessage(e, '小组不存在'))
    router.replace('/teams')
  } finally {
    loading.value = false
  }
}

async function loadRequests() {
  if (team.value?.myRole !== 'leader') return
  try {
    requests.value = await getTeamRequests(teamId)
  } catch {
    /* 非队长或无权限：静默忽略，列表保持原状 */
  }
}

async function handleLeave() {
  if (!team.value || leaveSubmitting.value) return
  if (!(await confirm('确认退出该小组？'))) return
  leaveSubmitting.value = true
  try {
    await leaveTeam(teamId)
    toast('已退出小组')
    // 退出后私密小组详情已不可读，直接回列表；不再请求已无权限的详情接口
    router.replace('/teams')
  } catch (e) {
    toast(getErrorMessage(e, '退出失败'))
  } finally {
    leaveSubmitting.value = false
  }
}

/** 撤回申请成功后同样失去私密小组详情读取权限，与退出统一走回列表 */
function handleWithdrawn() {
  router.replace('/teams')
}

async function handleTransfer(userId: string, name: string) {
  if (transferSubmitting.value) return
  if (!(await confirm(`确认将队长转让给 ${name}？`))) return
  transferSubmitting.value = true
  try {
    await transferLeader(teamId, userId)
    toast('已转让队长')
    await loadDetail()
  } catch (e) {
    toast(getErrorMessage(e, '转让失败'))
  } finally {
    transferSubmitting.value = false
  }
}

async function handleLeaderLeave(payload: { mode: 'disband' | 'transfer'; targetId: string }) {
  if (leaderLeaveSubmitting.value) return
  if (payload.mode === 'transfer' && !payload.targetId) {
    toast('请选择接任队长')
    return
  }
  leaderLeaveSubmitting.value = true
  try {
    if (payload.mode === 'disband') {
      await disbandTeam(teamId)
      toast('小组已解散')
    } else {
      await transferLeader(teamId, payload.targetId)
      await leaveTeam(teamId)
      toast('已退出小组')
    }
    router.replace('/teams')
  } catch (e) {
    toast(getErrorMessage(e, '操作失败'))
  } finally {
    leaderLeaveSubmitting.value = false
  }
}

// ---- 挑战同步（before/after 比较与 toast 依赖 loadDetail 时序，留页面层） ----
const syncSubmitting = ref<Record<string, boolean>>({})

async function syncChallenge(c: TeamChallenge) {
  if (syncSubmitting.value[c.id]) return
  syncSubmitting.value[c.id] = true
  try {
    await syncChallengeProgress(c.id)
    const before = c.isCompleted
    await loadDetail()
    const after = detail.value?.challenges.find((x) => x.id === c.id)
    if (!before && after?.isCompleted) toast('全员达标')
  } catch (e) {
    toast(getErrorMessage(e, '同步失败'))
  } finally {
    syncSubmitting.value[c.id] = false
  }
}

/** 进入详情自动同步进行中的挑战（静默）：由 ChallengeList onMounted 上抛意图；每次 loadDetail 会重挂载列表，需防重复执行 */
let autoSynced = false
async function onAutoSync() {
  if (autoSynced) return
  autoSynced = true
  await autoSync()
}

async function autoSync() {
  const actives = detail.value?.challenges.filter((c) => challengeStatus(c) === 'active') ?? []
  await Promise.all(actives.map((c) => syncChallengeProgress(c.id).catch(() => {})))
  if (actives.length) await loadDetail()
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-4">
    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>

    <template v-else-if="team">
      <button class="btn-ghost !px-2" @click="goBack">← 返回</button>

      <TeamHeaderCard
        :team-id="teamId"
        :team="team"
        :invite-code="detail?.inviteCode"
        :invite-code-expires-at="detail?.inviteCodeExpiresAt"
        :my-join-request="detail?.myJoinRequest"
        :leave-submitting="leaveSubmitting"
        @refresh="loadDetail"
        @edit="showEdit = true"
        @leave="handleLeave"
        @withdrawn="handleWithdrawn"
        @leader-leave="showLeaveModal = true"
      />

      <TeamMemberList
        :members="detail?.members ?? []"
        :my-role="team.myRole"
        :transfer-submitting="transferSubmitting"
        @open-profile="openProfile"
        @transfer="handleTransfer"
        @kick="kickTarget = $event"
      />

      <TeamJoinRequestList
        :team-id="teamId"
        :requests="requests"
        :my-role="team.myRole"
        @refresh="loadDetail"
        @open-profile="openProfile"
      />

      <TeamChallengeList
        :challenges="detail?.challenges ?? []"
        :member-count="detail?.members.length ?? 0"
        :my-role="team.myRole"
        :sync-submitting="syncSubmitting"
        @sync="syncChallenge"
        @create="showCreate = true"
        @edit="editingChallenge = $event"
        @refresh="loadDetail"
        @auto-sync="onAutoSync"
      />
    </template>
  </div>

  <ChallengeFormModal v-model:show="showCreate" mode="create" :team-id="teamId" @refresh="loadDetail" />

  <ChallengeFormModal
    :show="!!editingChallenge"
    mode="edit"
    :team-id="teamId"
    :challenge="editingChallenge"
    @update:show="editingChallenge = null"
    @refresh="loadDetail"
  />

  <TeamEditModal
    v-model:show="showEdit"
    :team-id="teamId"
    :team="team"
    :member-count="detail?.members.length ?? 0"
    @refresh="loadDetail"
  />

  <KickConfirmModal :team-id="teamId" :member="kickTarget" @close="kickTarget = null" @refresh="loadDetail" />

  <LeaderLeaveModal
    v-model:show="showLeaveModal"
    :members="detail?.members ?? []"
    :submitting="leaderLeaveSubmitting"
    @confirm="handleLeaderLeave"
  />

  <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
</template>
