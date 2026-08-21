<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTeamDetail, joinTeam, leaveTeam, transferLeader, disbandTeam } from '../api/teams'
import type { TeamDetail } from '../types'

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

onMounted(loadDetail)

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
          <div class="label !mb-0">挑战</div>
        </div>
        <div v-if="!detail?.challenges.length" class="text-center text-sm text-slate-400 py-6">
          暂无挑战
        </div>
      </div>
    </template>
  </div>
</template>
