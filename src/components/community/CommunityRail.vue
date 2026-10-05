<script setup lang="ts">
import { ArrowUpRight, ArrowRight } from '@lucide/vue'
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
  <div ref="root" class="community-rail space-y-4">
    <div class="community-rail-heading">
      <h2>今日同行</h2>
      <p>学习路上，总有同行</p>
    </div>
    <template v-if="visible">
      <WeeklyReportCard v-if="isLoggedIn" />
      <section v-if="hotTopics.length" class="card community-rail-section">
        <h3 class="section-title">本周讨论</h3>
        <button
          v-for="topic in hotTopics"
          :key="topic.tag"
          type="button"
          class="community-topic"
          @click="emit('tag', topic.tag)"
        >
          <span class="community-topic-hash" aria-hidden="true">#</span><span>{{ topic.text }}</span>
          <ArrowUpRight :size="16" class="text-action shrink-0 ml-auto" aria-hidden="true" />
        </button>
      </section>
      <section v-if="extras?.circles.length" class="card community-rail-section">
        <h3 class="section-title">正在交流的圈子</h3>
        <RouterLink
          v-for="circle in extras.circles"
          :key="circle.id"
          :to="{ name: 'circle-detail', params: { id: circle.id } }"
          class="flex items-center justify-between min-h-11 text-sm gap-3"
          ><span>{{ circle.name }}</span
          ><span class="font-data text-xs text-slate-500">{{ circle.memberCount }} 人</span></RouterLink
        >
      </section>
      <section v-if="extras?.users.length" class="card community-rail-section">
        <h3 class="section-title">发现同学</h3>
        <RouterLink
          v-for="user in extras.users"
          :key="user.userId"
          :to="{ name: 'profile', params: { id: user.userId } }"
          class="block py-3 text-sm"
          >{{ user.userName }}<span class="block text-xs text-slate-500 mt-1">{{ user.reason }}</span></RouterLink
        >
      </section>
      <section v-if="isLoggedIn" class="card community-rail-section">
        <h3 class="section-title">学习榜单</h3>
        <button
          type="button"
          class="community-board-toggle"
          :aria-expanded="board === 'checkin'"
          @click="board = board === 'checkin' ? '' : 'checkin'"
        >
          打卡榜
          <ArrowUpRight :size="16" aria-hidden="true" />
        </button>
        <LeaderboardBoard v-if="board === 'checkin'" />
        <button
          type="button"
          class="community-board-toggle"
          :aria-expanded="board === 'progress'"
          @click="board = board === 'progress' ? '' : 'progress'"
        >
          进步榜
          <ArrowUpRight :size="16" aria-hidden="true" />
        </button>
        <ProgressBoard v-if="board === 'progress'" />
      </section>
      <button type="button" class="community-rail-invite" @click="router.push({ name: 'teams' })">
        想找人一起备考？
        <span class="inline-flex items-center text-action"
          >查看搭子与小队 <ArrowRight :size="16" aria-hidden="true"
        /></span>
      </button>
    </template>
  </div>
</template>
