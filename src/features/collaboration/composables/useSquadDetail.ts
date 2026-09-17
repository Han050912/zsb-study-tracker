import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getErrorMessage } from '../../../utils/error'
import { useToast } from '../../../composables/useToast'
import { useConfirm } from '../../../composables/useConfirm'
import { useRoute, useRouter } from 'vue-router'
import { leaveTeam, transferLeader, disbandTeam, transferAndLeave } from '../../../api/teams'
import type { TeamChallenge, TeamMember } from '../../../types'
import { useSquadStore } from '../stores/squads'
import { useBack } from '../../../composables/useBack'

export function useSquadDetail() {
  const route = useRoute()
  const router = useRouter()
  const { goBack } = useBack()
  const toast = useToast()
  const confirm = useConfirm()
  const teamId = route.params.teamId as string
  const squads = useSquadStore()
  let disposed = false
  onBeforeUnmount(() => {
    disposed = true
    squads.cancelDetail(teamId)
  })

  const detail = computed(() => squads.detail(teamId))
  const state = computed(() => squads.details[teamId])
  const loading = computed(() => !detail.value && state.value?.loading.overview)
  const requests = computed(() => state.value?.requests ?? [])
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

  const invite = typeof route.query.invite === 'string' ? route.query.invite : undefined
  onMounted(async () => {
    await loadDetail()
    if (!disposed && team.value?.myRole && detail.value?.challenges.some((c) => c.status === 'active'))
      void squads.sync(teamId).catch(() => {})
  })
  async function loadDetail() {
    await squads.loadDetail(teamId, invite)
  }
  function loadMembers() {
    return squads.loadDetail(teamId, invite, 'members')
  }
  function loadChallenges() {
    return squads.loadDetail(teamId, invite, 'challenges')
  }
  function loadOverview() {
    return squads.loadDetail(teamId, invite, 'overview')
  }
  function reviewed(userId: string, accepted: boolean) {
    squads.reviewed(teamId, userId, accepted)
  }

  async function handleLeave() {
    if (!team.value || leaveSubmitting.value) return
    if (!(await confirm('确认退出该小组？'))) return
    leaveSubmitting.value = true
    try {
      await leaveTeam(teamId)
      toast('已退出小组')
      // 退出后私密小组详情已不可读，直接回列表；不再请求已无权限的详情接口
      router.replace({ name: 'teams' })
    } catch (e) {
      toast(getErrorMessage(e, '退出失败'))
    } finally {
      leaveSubmitting.value = false
    }
  }

  /** 撤回申请成功后同样失去私密小组详情读取权限，与退出统一走回列表 */
  function handleWithdrawn() {
    router.replace({ name: 'teams' })
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
        await transferAndLeave(teamId, payload.targetId)
        toast('已退出小组')
      }
      router.replace({ name: 'teams' })
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    } finally {
      leaderLeaveSubmitting.value = false
    }
  }

  const syncSubmitting = computed(() =>
    Object.fromEntries((detail.value?.challenges ?? []).map((c) => [c.id, !!state.value?.loading.challenges]))
  )
  async function syncChallenge(c: TeamChallenge) {
    try {
      await squads.sync(teamId)
      if (!c.isCompleted && squads.challengesById[c.id]?.isCompleted) toast('全员达标')
    } catch (e) {
      toast(getErrorMessage(e, '同步失败'))
    }
  }

  return {
    goBack,
    teamId,
    detail,
    state,
    loading,
    requests,
    leaveSubmitting,
    transferSubmitting,
    showProfile,
    profileUserId,
    kickTarget,
    showLeaveModal,
    leaderLeaveSubmitting,
    showEdit,
    showCreate,
    editingChallenge,
    team,
    openProfile,
    loadDetail,
    loadMembers,
    loadChallenges,
    loadOverview,
    reviewed,
    handleLeave,
    handleWithdrawn,
    handleTransfer,
    handleLeaderLeave,
    syncSubmitting,
    syncChallenge
  }
}
