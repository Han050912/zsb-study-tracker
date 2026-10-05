<script setup lang="ts">
import { ArrowUpRight, ArrowRight, Users, UserRoundCheck, Plus } from '@lucide/vue'
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
  <div class="collaboration-page study-page social-page together-page">
    <header class="social-heading">
      <div>
        <h1 class="social-title">搭子与小队</h1>
        <p class="social-description">约好下一次自习，把一个人的计划，变成一起完成的目标。</p>
      </div>
      <button class="btn-ghost together-join" @click="openDialog('invite')">
        加入小队 <ArrowUpRight :size="16" aria-hidden="true" />
      </button>
    </header>
    <AppTabs
      id="collaboration-mode"
      class="together-modes"
      :model-value="mode"
      :items="[
        { value: 'squads', label: '小队挑战' },
        { value: 'partners', label: '我的搭子' }
      ]"
      label="协作方式"
      @update:model-value="chooseMode"
    >
      <template #item="{ item }">
        <span class="together-mode-icon" aria-hidden="true">
          <Users v-if="item.value === 'squads'" :size="20" />
          <UserRoundCheck v-else :size="20" />
        </span>
        <span class="together-mode-copy">
          <strong>{{ item.label }}</strong>
          <span>{{ item.value === 'squads' ? '设定目标，和队友一起达标' : '固定搭档，一起自习与复盘' }}</span>
        </span>
      </template>
    </AppTabs>
    <div id="collaboration-mode-panel" role="tabpanel" :aria-labelledby="`collaboration-mode-tab-${mode}`">
      <Partners v-if="mode === 'partners' && isLoggedIn" />
      <div v-else class="social-columns">
        <section class="squad-main" aria-label="学习小队">
          <div class="squad-toolbar">
            <AppTabs
              id="squad-filter"
              class="squad-tabs"
              :model-value="activeTab"
              :items="[
                { value: 'my', label: '我的小队' },
                { value: 'public', label: '发现小队' }
              ]"
              label="小队范围"
              @update:model-value="chooseTab"
            /><button class="btn-primary" @click="openDialog('create')"><Plus :size="16" />创建小队</button>
          </div>
          <form class="squad-search" @submit.prevent="setQuery({ q: keyword || undefined })">
            <input
              v-model="keyword"
              class="input squad-search-input"
              aria-label="搜索小队"
              placeholder="搜索共同目标或小队名称"
              maxlength="100"
            /><button class="btn-ghost squad-search-submit">搜索</button
            ><select
              :value="store.query.challengeType"
              class="input squad-search-type"
              aria-label="挑战类型"
              @change="setQuery({ challengeType: ($event.target as HTMLSelectElement).value || undefined })"
            >
              <option value="">全部挑战</option>
              <option value="streak">连续打卡</option>
              <option value="minutes">学习时长</option>
              <option value="problems">刷题数量</option></select
            ><label class="squad-capacity"
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
            class="squad-results"
          >
            <AsyncState
              :loading="store.bucket?.loading && !store.teams.length"
              :error="!store.teams.length ? store.bucket?.error : undefined"
              :empty="!store.teams.length && !store.bucket?.loading"
              :message="
                activeTab === 'my'
                  ? '还没有加入小队，可以按科目或目标查找，也可以创建自己的小队。'
                  : '没有符合筛选的小队，试试其他名称或条件。'
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
              <article v-for="team in store.teams" :key="team.id" class="squad-card">
                <div class="flex justify-between items-start gap-3">
                  <span class="squad-avatar" aria-hidden="true">{{ team.name.slice(0, 1) }}</span>
                  <div class="min-w-0">
                    <button type="button" class="squad-name" @click="openTeam(team.id)">
                      {{ team.name }}
                      <ArrowUpRight :size="16" aria-hidden="true" class="text-action shrink-0" />
                    </button>
                    <p class="text-sm text-slate-500 mt-1 break-words">
                      {{ team.description || '和同学一起完成学习目标' }}
                    </p>
                  </div>
                  <span v-if="team.myRole === 'leader'" class="squad-role">队长</span>
                </div>
                <CompanionProgress
                  v-if="team.activeChallenge"
                  class="squad-challenge"
                  :challenge="team.activeChallenge"
                  :member-count="team.memberCount"
                  :show-mine="!!team.myRole"
                />
                <p v-else class="squad-waiting">
                  {{ team.myRole === 'leader' ? '发起一个挑战，约定下一次达标。' : '正在集结，等待下一个共同目标。' }}
                </p>
                <div class="squad-card-footer">
                  <span class="font-data"
                    >{{ team.memberCount }} / {{ team.maxMembers }} 人 · {{ team.isPublic ? '公开' : '私密' }}</span
                  ><button v-if="team.pendingRequestCount" class="text-correction" @click="openTeam(team.id)">
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
        <aside class="together-note">
          <h2>约一位学习搭子</h2>
          <p class="together-note-caption">两个人，也是一支队伍</p>
          <p class="together-note-description">有人一起开始，也有人一起坚持。和熟悉的同学约好下一次学习。</p>
          <ul class="together-note-list">
            <li><span>一起自习</span><span>给专注留一段时间</span></li>
            <li><span>共同计划</span><span>把目标拆成每天的行动</span></li>
            <li><span>定期复盘</span><span>交换方法，核对进度</span></li>
          </ul>
          <button type="button" class="btn-ghost w-full together-note-action" @click="chooseMode('partners')">
            查看我的搭子 <ArrowRight :size="16" aria-hidden="true" />
          </button>
          <p class="together-note-footnote">最多可添加 3 位学习搭子</p>
        </aside>
      </div>
    </div>
    <SquadDialogs v-if="dialog" :mode="dialog" @close="dialog = null" @created="store.loadList()" />
  </div>
</template>
