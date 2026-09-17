<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSquadStore } from '../features/collaboration/stores/squads'
import { isLoggedIn, requireLogin } from '../services/auth'
import AppTabs from '../shared/components/AppTabs.vue'
import AsyncState from '../shared/components/AsyncState.vue'
import CompanionProgress from '../components/team/CompanionProgress.vue'
const Partners = defineAsyncComponent(() => import('./Partners.vue'))
const SquadDialogs = defineAsyncComponent(() => import('../components/team/SquadDialogs.vue'))
const store = useSquadStore(),
  route = useRoute(),
  router = useRouter()
const mode = computed(() => (route.query.mode === 'partners' ? 'partners' : 'squads'))
const activeTab = computed(() => (route.query.filter === 'public' || !isLoggedIn.value ? 'public' : 'my'))
const dialog = ref<'create' | 'invite' | null>(null),
  keyword = ref('')
const setQuery = (patch: Record<string, string | undefined>) =>
  router.push({ name: 'teams', query: { ...route.query, ...patch } })
function chooseMode(value: string) {
  if (value === 'partners' && requireLogin(router)) return
  void setQuery({ mode: value })
}
function chooseTab(value: string) {
  if (value === 'my' && requireLogin(router)) return
  void setQuery({ filter: value })
}
function openDialog(value: 'create' | 'invite') {
  if (!requireLogin(router)) dialog.value = value
}
function openTeam(id: string) {
  if (!requireLogin(router)) void router.push({ name: 'team-detail', params: { teamId: id } })
}
watch(
  () => route.query,
  () => {
    if (route.name !== 'teams' || mode.value !== 'squads') return
    keyword.value = typeof route.query.q === 'string' ? route.query.q : ''
    store.query = {
      filter: activeTab.value,
      keyword: keyword.value,
      capacity: route.query.capacity === 'available' ? 'available' : '',
      challengeType: typeof route.query.challengeType === 'string' ? route.query.challengeType : ''
    }
    void store.loadList()
  },
  { immediate: true }
)
</script>
<template>
  <div class="collaboration-page max-w-6xl mx-auto p-4 md:p-6 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs text-slate-500 mb-1">有人和你一起，把目标走完</p>
        <h1 class="collaboration-title">组队协作</h1>
      </div>
      <button class="btn-ghost" @click="openDialog('invite')">加入小队 ↗</button>
    </header>
    <AppTabs
      id="collaboration-mode"
      :model-value="mode"
      :items="[
        { value: 'squads', label: '小队挑战' },
        { value: 'partners', label: '搭子协作' }
      ]"
      label="协作方式"
      @update:model-value="chooseMode"
    />
    <div id="collaboration-mode-panel" role="tabpanel" :aria-labelledby="`collaboration-mode-tab-${mode}`">
      <Partners v-if="mode === 'partners' && isLoggedIn" />
      <div v-else class="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-8 items-start">
        <section class="min-w-0 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <AppTabs
              id="squad-filter"
              :model-value="activeTab"
              :items="[
                { value: 'my', label: '我的小队' },
                { value: 'public', label: '发现小队' }
              ]"
              label="小队范围"
              @update:model-value="chooseTab"
            /><button class="btn-primary" @click="openDialog('create')">＋ 创建小队</button>
          </div>
          <form class="flex flex-wrap gap-2" @submit.prevent="setQuery({ q: keyword || undefined })">
            <input
              v-model="keyword"
              class="input flex-1 !w-auto !min-w-[12rem]"
              aria-label="搜索小队"
              placeholder="搜索共同目标或小队名称"
              maxlength="100"
            /><button class="btn-ghost">搜索</button
            ><select
              :value="store.query.challengeType"
              class="input !w-auto"
              aria-label="挑战类型"
              @change="setQuery({ challengeType: ($event.target as HTMLSelectElement).value || undefined })"
            >
              <option value="">全部挑战</option>
              <option value="streak">连续打卡</option>
              <option value="minutes">学习时长</option>
              <option value="problems">刷题数量</option></select
            ><label class="flex items-center gap-2 text-sm"
              ><input
                type="checkbox"
                class="!min-h-0"
                :checked="store.query.capacity === 'available'"
                @change="setQuery({ capacity: ($event.target as HTMLInputElement).checked ? 'available' : undefined })"
              />未满员</label
            >
          </form>
          <div
            id="squad-filter-panel"
            role="tabpanel"
            :aria-labelledby="`squad-filter-tab-${activeTab}`"
            class="space-y-4"
          >
            <AsyncState
              :loading="store.bucket?.loading && !store.teams.length"
              :error="!store.teams.length ? store.bucket?.error : undefined"
              :empty="!store.teams.length && !store.bucket?.loading"
              :message="
                activeTab === 'my' ? '还没有同行的小队，加入一个共同目标。' : '没有符合筛选的小队，试试其他名称或条件。'
              "
              @retry="store.loadList()"
            >
              <template #action
                ><button
                  class="btn-ghost"
                  @click="
                    activeTab === 'my'
                      ? chooseTab('public')
                      : setQuery({ q: undefined, capacity: undefined, challengeType: undefined })
                  "
                >
                  {{ activeTab === 'my' ? '发现公开小队' : '清除筛选' }}
                </button></template
              >
              <AsyncState
                v-if="store.bucket?.error"
                :error="store.bucket.error"
                @retry="store.loadList(store.bucket?.retryReset ?? true)"
              />
              <p v-if="store.bucket?.loading" role="status" class="text-xs text-slate-500">正在更新小队…</p>
              <article v-for="team in store.teams" :key="team.id" class="card space-y-5">
                <div class="flex justify-between items-start gap-3">
                  <div class="min-w-0">
                    <button class="text-lg text-left font-semibold break-words" @click="openTeam(team.id)">
                      {{ team.name }} <span aria-hidden="true" class="text-primary-500">↗</span>
                    </button>
                    <p class="text-sm text-slate-500 mt-1 break-words">
                      {{ team.description || '和同学一起完成学习目标' }}
                    </p>
                  </div>
                  <span v-if="team.myRole === 'leader'" class="text-xs shrink-0 pt-3">队长</span>
                </div>
                <CompanionProgress
                  v-if="team.activeChallenge"
                  :challenge="team.activeChallenge"
                  :member-count="team.memberCount"
                  :show-mine="!!team.myRole"
                />
                <p v-else class="text-sm text-slate-500 py-2">
                  {{ team.myRole === 'leader' ? '发起一个挑战，约定下一次达标。' : '正在集结，等待下一个共同目标。' }}
                </p>
                <div class="flex justify-between flex-wrap gap-2 text-xs text-slate-500">
                  <span class="training-number"
                    >{{ team.memberCount }} / {{ team.maxMembers }} 人 · {{ team.isPublic ? '公开' : '私密' }}</span
                  ><button v-if="team.pendingRequestCount" class="text-red-500" @click="openTeam(team.id)">
                    {{ team.pendingRequestCount }} 条申请待审核</button
                  ><span v-else-if="!isLoggedIn">登录后可查看详情</span>
                </div>
              </article>
            </AsyncState>
            <button
              v-if="store.bucket?.cursor && !store.bucket.error"
              class="btn-ghost w-full"
              :disabled="store.bucket.loading"
              @click="store.loadList(false)"
            >
              加载更多小队
            </button>
          </div>
        </section>
        <aside class="card space-y-4">
          <p class="text-xs text-slate-500">一对一，也能走得更远</p>
          <h2 class="font-semibold text-lg">约一位学习搭子</h2>
          <p class="text-sm text-slate-500 leading-relaxed">一起自习，把计划拆成每天的行动，再约一次复盘。</p>
          <button class="btn-ghost w-full" @click="chooseMode('partners')">进入搭子协作 →</button>
        </aside>
      </div>
    </div>
    <SquadDialogs v-if="dialog" :mode="dialog" @close="dialog = null" @created="store.loadList()" />
  </div>
</template>
