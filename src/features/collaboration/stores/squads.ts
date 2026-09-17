import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getTeams, getTeamDetail, getTeamRequests, syncActiveChallenges, type SquadQuery } from '../../../api/teams'
import { getErrorMessage } from '../../../utils/error'
import type { StudyTeam, TeamChallenge, TeamMember, TeamJoinRequest, TeamDetail } from '../../../types'

interface ListBucket {
  ids: string[]
  cursor: string | null
  loading: boolean
  error: string
  updatedAt: number
  retryReset?: boolean
}
type Section = 'overview' | 'members' | 'challenges' | 'requests'
interface DetailBucket {
  challengeIds: string[]
  members: TeamMember[]
  requests: TeamJoinRequest[]
  inviteCode?: string | null
  inviteCodeExpiresAt?: number | null
  myJoinRequest?: boolean
  loading: Partial<Record<Section, boolean>>
  errors: Partial<Record<Section, string>>
}
export const useSquadStore = defineStore('collaboration-squads', () => {
  const teamsById = ref<Record<string, StudyTeam>>({}),
    challengesById = ref<Record<string, TeamChallenge>>({})
  const listIdsByFilter = ref<Record<string, ListBucket>>({}),
    details = ref<Record<string, DetailBucket>>({})
  const query = ref<SquadQuery>({ filter: 'my', keyword: '', capacity: '', challengeType: '' })
  const key = computed(() => JSON.stringify(query.value))
  const bucket = computed(() => listIdsByFilter.value[key.value])
  const teams = computed(() => (bucket.value?.ids ?? []).map((id) => teamsById.value[id]).filter(Boolean))
  let generation = 0,
    listTicket = 0
  const tickets = new Map<string, number>()
  function ensure(id: string) {
    if (!details.value[id]) details.value[id] = { challengeIds: [], members: [], requests: [], loading: {}, errors: {} }
    return details.value[id]
  }
  function patchTeam(team: StudyTeam) {
    if (teamsById.value[team.id]) Object.assign(teamsById.value[team.id], team)
    else teamsById.value[team.id] = team
  }
  function patchChallenges(id: string, challenges: TeamChallenge[]) {
    for (const c of challenges) {
      if (challengesById.value[c.id]) Object.assign(challengesById.value[c.id], c)
      else challengesById.value[c.id] = c
    }
    ensure(id).challengeIds = challenges.map((c) => c.id)
    const team = teamsById.value[id]
    if (team) team.activeChallenge = challenges.find((c) => c.status === 'active')
  }
  async function loadList(reset = true) {
    if (!listIdsByFilter.value[key.value])
      listIdsByFilter.value[key.value] = { ids: [], cursor: null, loading: false, error: '', updatedAt: 0 }
    const list = listIdsByFilter.value[key.value]
    if (!reset && (list.loading || !list.cursor)) return
    const ticket = ++listTicket,
      owner = generation,
      requestKey = key.value
    list.retryReset = reset
    list.loading = true
    list.error = ''
    try {
      const result = await getTeams(query.value, reset ? null : list.cursor)
      if (ticket !== listTicket || owner !== generation) return
      for (const team of result.teams) patchTeam(team)
      list.ids = [...new Set([...(reset ? [] : list.ids), ...result.teams.map((t) => t.id)])]
      list.cursor = result.nextCursor
      list.updatedAt = Date.now()
    } catch (e) {
      if (ticket === listTicket && owner === generation) list.error = getErrorMessage(e, '小队加载失败')
    } finally {
      if (ticket === listTicket || key.value !== requestKey) list.loading = false
    }
  }
  async function loadDetail(id: string, invite?: string, section?: Section) {
    const state = ensure(id),
      part = section ?? 'overview',
      requestKey = id + ':' + part
    const ticket = (tickets.get(requestKey) ?? 0) + 1,
      owner = generation
    tickets.set(requestKey, ticket)
    state.loading[part] = true
    state.errors[part] = ''
    try {
      if (part === 'requests') {
        const requests = await getTeamRequests(id)
        if (owner === generation && tickets.get(requestKey) === ticket) state.requests = requests
        return
      }
      const result = await getTeamDetail(id, invite, section === 'requests' ? undefined : section)
      if (owner !== generation || tickets.get(requestKey) !== ticket) return
      patchTeam(result.team)
      if (!section || section === 'members') state.members = result.members
      if (!section || section === 'challenges') patchChallenges(id, result.challenges)
      Object.assign(state, {
        inviteCode: result.inviteCode,
        inviteCodeExpiresAt: result.inviteCodeExpiresAt,
        myJoinRequest: result.myJoinRequest
      })
      if (!section && result.team.myRole === 'leader') void loadDetail(id, invite, 'requests')
    } catch (e) {
      if (owner === generation && tickets.get(requestKey) === ticket)
        state.errors[part] = getErrorMessage(e, '加载失败，请重试')
    } finally {
      if (tickets.get(requestKey) === ticket) state.loading[part] = false
    }
  }
  async function sync(id: string) {
    const owner = generation,
      state = ensure(id)
    if (state.loading.challenges) return
    const requestKey = id + ':challenges',
      ticket = (tickets.get(requestKey) ?? 0) + 1
    tickets.set(requestKey, ticket)
    state.loading.challenges = true
    state.errors.challenges = ''
    try {
      const result = await syncActiveChallenges(id)
      if (owner === generation && tickets.get(requestKey) === ticket) patchChallenges(id, result.challenges)
    } catch (e) {
      if (owner === generation && tickets.get(requestKey) === ticket)
        state.errors.challenges = getErrorMessage(e, '进度同步失败')
      throw e
    } finally {
      if (tickets.get(requestKey) === ticket) state.loading.challenges = false
    }
  }
  function detail(id: string): TeamDetail | null {
    const team = teamsById.value[id],
      state = details.value[id]
    return team && state
      ? {
          team,
          members: state.members,
          challenges: state.challengeIds.map((cid) => challengesById.value[cid]).filter(Boolean),
          inviteCode: state.inviteCode,
          inviteCodeExpiresAt: state.inviteCodeExpiresAt,
          myJoinRequest: state.myJoinRequest
        }
      : null
  }
  function reviewed(id: string, userId: string, accepted: boolean) {
    const state = ensure(id),
      request = state.requests.find((r) => r.userId === userId)
    state.requests = state.requests.filter((r) => r.userId !== userId)
    if (accepted && request && !state.members.some((m) => m.userId === userId)) {
      state.members.push({ ...request, role: 'member', joinedAt: Date.now() / 1000 })
      if (teamsById.value[id]) teamsById.value[id].memberCount = state.members.length
    }
    if (teamsById.value[id]) teamsById.value[id].pendingRequestCount = state.requests.length
    void loadDetail(id, undefined, 'members')
    void loadDetail(id, undefined, 'requests')
  }
  function resetState() {
    generation++
    listTicket++
    tickets.clear()
    teamsById.value = {}
    challengesById.value = {}
    listIdsByFilter.value = {}
    details.value = {}
  }
  function cancelDetail(id: string) {
    for (const [key, ticket] of tickets) if (key.startsWith(id + ':')) tickets.set(key, ticket + 1)
    if (details.value[id]) details.value[id].loading = {}
  }
  return {
    teamsById,
    challengesById,
    listIdsByFilter,
    details,
    query,
    bucket,
    teams,
    loadList,
    loadDetail,
    sync,
    detail,
    reviewed,
    resetState,
    cancelDetail
  }
})
