<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import { nextTick, ref } from 'vue'
import { useSquadDetail } from '../features/collaboration/composables/useSquadDetail'
import AsyncState from '../shared/components/AsyncState.vue'
import AppTabs from '../shared/components/AppTabs.vue'
import TeamHeaderCard from '../components/team/TeamHeaderCard.vue'
import TeamMemberList from '../components/team/TeamMemberList.vue'
import TeamJoinRequestList from '../components/team/TeamJoinRequestList.vue'
import TeamChallengeList from '../components/team/TeamChallengeList.vue'
import ChallengeFormModal from '../components/team/ChallengeFormModal.vue'
import TeamEditModal from '../components/team/TeamEditModal.vue'
import KickConfirmModal from '../components/team/KickConfirmModal.vue'
import LeaderLeaveModal from '../components/team/LeaderLeaveModal.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
const {
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
} = useSquadDetail()
const section = ref('challenges')
const membersSection = ref<HTMLElement | null>(null)
const requestsSection = ref<HTMLElement | null>(null)
const disbandOnly = ref(false)
async function openManagement(target: 'members' | 'requests') {
  section.value = 'members'
  await nextTick()
  const element = target === 'members' ? membersSection.value : requestsSection.value
  element?.scrollIntoView({ block: 'start' })
  element?.focus({ preventScroll: true })
}
function openLeaderLeave(onlyDisband = false) {
  disbandOnly.value = onlyDisband
  showLeaveModal.value = true
}
</script>

<template>
  <div class="collaboration-page study-page space-y-4">
    <AsyncState
      v-if="loading || state?.errors.overview"
      :loading="loading"
      :error="state?.errors.overview"
      @retry="loadDetail"
    />

    <template v-else-if="team">
      <span class="arrow-action" @click="goBack"
        ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
      >

      <TeamHeaderCard
        :team-id="teamId"
        :team="team"
        :invite-code="detail?.inviteCode"
        :invite-code-expires-at="detail?.inviteCodeExpiresAt"
        :my-join-request="detail?.myJoinRequest"
        :leave-submitting="leaveSubmitting"
        @refresh="loadOverview"
        @edit="showEdit = true"
        @leave="handleLeave"
        @withdrawn="handleWithdrawn"
        @leader-leave="openLeaderLeave()"
        @manage="openManagement"
        @disband="openLeaderLeave(true)"
      />

      <div class="lg:hidden">
        <AppTabs
          id="squad-section"
          v-model="section"
          :items="[
            { value: 'challenges', label: '挑战' },
            { value: 'members', label: '成员' },
            { value: 'info', label: '信息' }
          ]"
          label="小队详情"
        />
      </div>
      <div
        id="squad-section-panel"
        role="tabpanel"
        :aria-labelledby="`squad-section-tab-${section}`"
        class="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start"
      >
        <section class="min-w-0 space-y-4 lg:block" :class="section === 'challenges' ? '' : 'hidden'">
          <AsyncState v-if="state?.errors.challenges" :error="state.errors.challenges" @retry="loadChallenges" />
          <TeamChallengeList
            :challenges="detail?.challenges ?? []"
            :member-count="team.memberCount"
            :my-role="team.myRole"
            :sync-submitting="syncSubmitting"
            @sync="syncChallenge"
            @create="showCreate = true"
            @edit="editingChallenge = $event"
            @refresh="loadChallenges"
          />
        </section>
        <aside class="space-y-4 lg:block" :class="section === 'members' || section === 'info' ? '' : 'hidden'">
          <div :class="section === 'info' ? 'hidden lg:block' : ''" class="space-y-4">
            <AsyncState v-if="state?.errors.members" :error="state.errors.members" @retry="loadMembers" />
            <div ref="membersSection" tabindex="-1" aria-label="小队成员管理">
              <TeamMemberList
                :members="detail?.members ?? []"
                :my-role="team.myRole"
                :transfer-submitting="transferSubmitting"
                @open-profile="openProfile"
                @transfer="handleTransfer"
                @kick="kickTarget = $event"
              />
            </div>
            <div v-if="team.myRole === 'leader'" ref="requestsSection" tabindex="-1" aria-label="小队加队审批">
              <TeamJoinRequestList
                :team-id="teamId"
                :requests="requests"
                :my-role="team.myRole"
                @reviewed="reviewed"
                @open-profile="openProfile"
              />
            </div>

            <AsyncState v-if="state?.errors.requests" :error="state.errors.requests" @retry="loadDetail" />
          </div>
          <section class="card space-y-3" :class="section !== 'info' ? 'hidden lg:block' : ''">
            <h2 class="font-semibold">小队信息</h2>
            <p class="text-sm break-words">{{ team.description || '一起坚持，完成共同目标。' }}</p>
            <p class="text-xs text-slate-500">
              {{ team.isPublic ? '公开加入' : '邀请码申请' }} · 最多 {{ team.maxMembers }} 人
            </p>
            <p class="text-xs text-slate-500">
              创建于 {{ new Date(team.createdAt * 1000).toLocaleDateString('zh-CN') }}
            </p>
          </section>
        </aside>
      </div>
    </template>
  </div>

  <ChallengeFormModal v-model:show="showCreate" mode="create" :team-id="teamId" @refresh="loadChallenges" />

  <ChallengeFormModal
    :show="!!editingChallenge"
    mode="edit"
    :team-id="teamId"
    :challenge="editingChallenge"
    @update:show="editingChallenge = null"
    @refresh="loadChallenges"
  />

  <TeamEditModal
    v-model:show="showEdit"
    :team-id="teamId"
    :team="team"
    :member-count="detail?.members.length ?? 0"
    @refresh="loadOverview"
  />

  <KickConfirmModal :team-id="teamId" :member="kickTarget" @close="kickTarget = null" @refresh="loadMembers" />

  <LeaderLeaveModal
    v-model:show="showLeaveModal"
    :members="detail?.members ?? []"
    :submitting="leaderLeaveSubmitting"
    :team-name="team?.name ?? ''"
    :disband-only="disbandOnly"
    @confirm="handleLeaderLeave"
  />

  <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
</template>
