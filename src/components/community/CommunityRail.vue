<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { postsApi } from '../../api/community/posts'
import { isLoggedIn } from '../../services/auth'
import type { CommunityCircle, RecommendUser, HotTopic } from '../../types'
defineProps<{ extras: { circles: CommunityCircle[]; users: RecommendUser[] } | null }>()
const emit = defineEmits<{ tag: [value: string] }>()
const WeeklyReportCard = defineAsyncComponent(() => import('./WeeklyReportCard.vue'))
const LeaderboardBoard = defineAsyncComponent(() => import('./LeaderboardBoard.vue'))
const ProgressBoard = defineAsyncComponent(() => import('./ProgressBoard.vue'))
const router = useRouter(),
  root = ref<HTMLElement | null>(null),
  visible = ref(false),
  board = ref(''),
  hotTopics = ref<HotTopic[]>([])
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    visible.value = true
    observer?.disconnect()
    void postsApi
      .hotTopics()
      .then((res) => {
        hotTopics.value = res.topics
      })
      .catch(() => {})
  })
  if (root.value) observer.observe(root.value)
})
onUnmounted(() => observer?.disconnect())
</script>
<template>
  <div ref="root" class="space-y-4">
    <div>
      <h2 class="font-semibold">今日同行</h2>
      <p class="text-xs text-slate-500 mt-1">看看同学们走到了哪里</p>
    </div>
    <template v-if="visible">
      <WeeklyReportCard v-if="isLoggedIn" />
      <section v-if="hotTopics.length" class="card">
        <h3 class="section-title">本周讨论</h3>
        <button
          v-for="topic in hotTopics"
          :key="topic.tag"
          class="block text-sm text-left w-full"
          @click="emit('tag', topic.tag)"
        >
          {{ topic.text }} <span class="text-primary-500">↗</span>
        </button>
      </section>
      <section v-if="extras?.circles.length" class="card">
        <h3 class="section-title">正在交流的圈子</h3>
        <RouterLink
          v-for="circle in extras.circles"
          :key="circle.id"
          :to="{ name: 'circle-detail', params: { id: circle.id } }"
          class="flex items-center justify-between min-h-11 text-sm gap-3"
          ><span>{{ circle.name }}</span
          ><span class="training-number text-xs text-slate-500">{{ circle.memberCount }} 人</span></RouterLink
        >
      </section>
      <section v-if="extras?.users.length" class="card">
        <h3 class="section-title">发现同学</h3>
        <RouterLink
          v-for="user in extras.users"
          :key="user.userId"
          :to="{ name: 'profile', params: { id: user.userId } }"
          class="block py-3 text-sm"
          >{{ user.userName }}<span class="block text-xs text-slate-500 mt-1">{{ user.reason }}</span></RouterLink
        >
      </section>
      <section v-if="isLoggedIn" class="card">
        <h3 class="section-title">学习榜单</h3>
        <button
          class="w-full text-left text-sm"
          @click="board = board === 'checkin' ? '' : 'checkin'"
          :aria-expanded="board === 'checkin'"
        >
          打卡榜 <span class="float-right">↗</span></button
        ><LeaderboardBoard v-if="board === 'checkin'" /><button
          class="w-full text-left text-sm"
          @click="board = board === 'progress' ? '' : 'progress'"
          :aria-expanded="board === 'progress'"
        >
          进步榜 <span class="float-right">↗</span></button
        ><ProgressBoard v-if="board === 'progress'" />
      </section>
      <button class="card w-full text-left text-sm" @click="router.push({ name: 'teams' })">
        把目标交给彼此 <span class="block mt-2 text-primary-500">去组队协作 →</span>
      </button>
    </template>
  </div>
</template>
