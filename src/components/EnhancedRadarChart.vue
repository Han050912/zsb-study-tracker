<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { useChart, chartTextColor, chartColor } from '../composables/useChart'
import ChartFallback from './ChartFallback.vue'
import type { TopicImportance } from '../types'

interface RadarDataItem {
  name: string
  value: number
  max?: number
  importance?: TopicImportance
}

interface ChapterGroup {
  chapterId: string
  chapterName: string
  topics: RadarDataItem[]
}

const props = defineProps<{
  chapters: ChapterGroup[]
  color?: string
  title?: string
}>()

const currentPage = ref(0)

/** 选中的薄弱词条（跨章节可能重名，用 pageIndex + name 定位）；null 表示未选中 */
interface SelectedTopic {
  name: string
  pageIndex: number
}
const selectedTopic = ref<SelectedTopic | null>(null)

// 导航条滚动容器（章节标签）
const navRef = ref<HTMLElement | null>(null)

/** 将导航条滚动定位到当前选中章节标签 */
function scrollNavToActive() {
  const target = navRef.value?.children[currentPage.value] as HTMLElement | undefined
  target?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    inline: 'center',
    block: 'nearest'
  })
}

// 章节选中变化时联动导航条定位
watch(currentPage, () => nextTick(scrollNavToActive))

/** 滚轮滑动导航条（垂直滚轮映射为横向滚动） */
function onNavWheel(e: WheelEvent) {
  const nav = navRef.value
  if (!nav) return
  nav.scrollLeft += e.deltaY
}

// 总知识点数量
const totalTopics = computed(() => {
  return props.chapters.reduce((sum, ch) => sum + ch.topics.length, 0)
})

// 是否需要分章节展示（超过8个知识点时）
const needPagination = computed(() => totalTopics.value > 8)

// 分组数据：如果≤8个知识点则合并展示，否则按章节分组
const groups = computed(() => {
  const nonEmptyChapters = props.chapters.filter((ch) => ch.topics.length > 0)
  if (!needPagination.value) {
    // 总数≤8，合并所有章节到一组
    return [
      {
        chapterName: '全部知识点',
        topics: nonEmptyChapters.flatMap((ch) => ch.topics)
      }
    ]
  }
  // 超过8个，按章节分组
  return nonEmptyChapters.map((ch) => ({
    chapterName: ch.chapterName,
    topics: ch.topics
  }))
})

const ratedTopics = computed(() => currentGroup.value.topics.filter((item) => item.value >= 1 && item.value <= 5))
const totalPages = computed(() => groups.value.length)
const currentGroup = computed(() => groups.value[currentPage.value] || { chapterName: '', topics: [] })
const hasMultiplePages = computed(() => totalPages.value > 1)

// 当数据变化时重置页码
watch(totalPages, () => {
  if (currentPage.value >= totalPages.value) {
    currentPage.value = Math.max(0, totalPages.value - 1)
  }
})

// 切换页面
function goToPage(page: number) {
  if (page >= 0 && page < totalPages.value) {
    currentPage.value = page
    selectedTopic.value = null // 切换章节时词条选中失效
  }
}

/** 选中薄弱词条：定位到所在章节并保留词条选中（不经 goToPage 的清空逻辑） */
function selectTopic(topic: SelectedTopic) {
  selectedTopic.value = topic
  currentPage.value = topic.pageIndex
}

function nextPage() {
  goToPage(currentPage.value + 1)
}
function prevPage() {
  goToPage(currentPage.value - 1)
}

// 雷达图配置
const {
  el: radarEl,
  status: radarStatus,
  retry: retryRadar
} = useChart(() => {
  if (ratedTopics.value.length < 3) return null

  return {
    radar: {
      indicator: ratedTopics.value.map((item) => ({
        name: item.name,
        max: item.max || 5
      })),
      radius: '65%',
      axisLine: { lineStyle: { color: chartColor('muted') + '55' } },
      splitLine: { lineStyle: { color: chartColor('muted') + '33' } },
      axisName: {
        color: chartTextColor(),
        fontSize: 10,
        overflow: 'truncate',
        width: 60
      },
      splitArea: {
        areaStyle: {
          color: [chartColor('surface')]
        }
      }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: ratedTopics.value.map((item) => item.value),
            name: '掌握度',
            areaStyle: {
              color: chartColor('action') + '22'
            },
            lineStyle: {
              color: chartColor('action'),
              width: 2
            },
            itemStyle: {
              color: chartColor('action')
            }
          }
        ]
      }
    ]
  }
}, [currentGroup])

// 统计信息
const stats = computed(() => {
  const values = ratedTopics.value.map((item) => item.value)
  if (values.length === 0) return null

  const avg = values.reduce((sum, v) => sum + v, 0) / values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const weak = currentGroup.value.topics.filter((item) => item.value > 0 && item.value < 3)

  return { avg, min, max, weakCount: weak.length }
})

// 获取所有薄弱知识点（跨章节）
const allWeakTopics = computed(() => {
  const result: Array<{ topic: RadarDataItem; chapterName: string; pageIndex: number }> = []
  groups.value.forEach((group, idx) => {
    group.topics.forEach((topic) => {
      if (topic.value > 0 && topic.value < 3) {
        result.push({ topic, chapterName: group.chapterName, pageIndex: idx })
      }
    })
  })
  return result
})

/** 选中词条的详情数据（名称/掌握度/重要程度/章节） */
const selectedTopicDetail = computed(() => {
  const t = selectedTopic.value
  if (!t) return null
  const group = groups.value[t.pageIndex]
  const topic = group?.topics.find((x) => x.name === t.name)
  if (!group || !topic) return null
  return {
    name: topic.name,
    value: topic.value,
    importance: topic.importance || 'normal',
    chapterName: group.chapterName
  }
})
</script>

<template>
  <div class="space-y-3">
    <div class="study-section-heading !mb-0 flex-wrap">
      <h3 class="text-sm font-bold">{{ title || '知识点自评' }}</h3>
      <span class="study-note"
        >已评 {{ ratedTopics.length }}/{{ currentGroup.topics.length }} 个<span v-if="stats">
          · 均分 {{ stats.avg.toFixed(1) }}/5</span
        ></span
      >
    </div>
    <div v-if="hasMultiplePages" class="flex items-center gap-2">
      <IconAction :icon="ArrowLeft" label="上一章" :disabled="currentPage === 0" class="shrink-0" @click="prevPage" />
      <div ref="navRef" class="flex gap-2 overflow-x-auto flex-1" @wheel.prevent="onNavWheel">
        <button
          v-for="(group, index) in groups"
          :key="group.chapterName"
          class="btn shrink-0 text-xs"
          :class="currentPage === index ? 'bg-action-soft text-action' : ''"
          :aria-current="currentPage === index ? 'true' : undefined"
          @click="goToPage(index)"
        >
          {{ group.chapterName }}
        </button>
      </div>
      <IconAction
        :icon="ArrowRight"
        label="下一章"
        :disabled="currentPage === totalPages - 1"
        class="shrink-0"
        @click="nextPage"
      />
    </div>
    <div class="grid md:grid-cols-2 gap-4 items-center">
      <div v-if="ratedTopics.length >= 3">
        <ChartFallback v-if="radarStatus === 'error'" class="h-64" @retry="retryRadar" />
        <div
          v-else
          ref="radarEl"
          class="h-64"
          role="img"
          :aria-label="`${currentGroup.chapterName}自评雷达，满分5分，具体数值见相邻列表`"
        ></div>
      </div>
      <p v-else class="study-note py-6">至少自评 3 个知识点后显示雷达图。未自评的知识点不会被算作 0 分。</p>
      <div class="max-h-64 overflow-y-auto">
        <div
          v-for="topic in currentGroup.topics"
          :key="topic.name"
          class="flex justify-between gap-3 border-b border-line py-2 text-xs"
        >
          <span>{{ topic.name }}</span
          ><span class="shrink-0" :class="topic.value > 0 && topic.value < 3 ? 'text-correction' : 'text-muted'">{{
            topic.value > 0 ? topic.value + '/5' : '未自评'
          }}</span>
        </div>
        <p v-if="!totalTopics" class="study-note">先添加章节知识点，再记录自评。</p>
      </div>
    </div>
    <p class="study-note">1 分表示刚接触，5 分表示能独立解题。自评用于安排复习，不代表考试得分。</p>
    <div v-if="allWeakTopics.length" class="border-t border-line pt-3">
      <p class="text-xs text-muted mb-2">先复习这些 · 自评低于 3 分</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="item in allWeakTopics"
          :key="`${item.pageIndex}-${item.topic.name}`"
          class="btn-ghost text-xs"
          @click="selectTopic({ name: item.topic.name, pageIndex: item.pageIndex })"
        >
          {{ item.topic.name }}
        </button>
      </div>
      <p v-if="selectedTopicDetail" class="study-note mt-2" role="status">
        {{ selectedTopicDetail.chapterName }} · {{ selectedTopicDetail.name }} · 当前自评
        {{ selectedTopicDetail.value }}/5，可在下方章节中更新。
      </p>
    </div>
  </div>
</template>
