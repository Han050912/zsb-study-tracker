<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useChart, chartTextColor } from '../composables/useChart'
import StarRating from './StarRating.vue'
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
interface SelectedTopic { name: string; pageIndex: number }
const selectedTopic = ref<SelectedTopic | null>(null)

// 导航条滚动容器（章节标签）
const navRef = ref<HTMLElement | null>(null)

/** 将导航条滚动定位到当前选中章节标签 */
function scrollNavToActive() {
  const target = navRef.value?.children[currentPage.value] as HTMLElement | undefined
  target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
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
  const nonEmptyChapters = props.chapters.filter(ch => ch.topics.length > 0)
  if (!needPagination.value) {
    // 总数≤8，合并所有章节到一组
    return [{
      chapterName: '全部知识点',
      topics: nonEmptyChapters.flatMap(ch => ch.topics)
    }]
  }
  // 超过8个，按章节分组
  return nonEmptyChapters.map(ch => ({
    chapterName: ch.chapterName,
    topics: ch.topics
  }))
})

const totalPages = computed(() => groups.value.length)
const currentGroup = computed(() => groups.value[currentPage.value] || { chapterName: '', topics: [] })
const hasMultiplePages = computed(() => totalPages.value > 1)

// 当数据变化时重置页码
watch(() => props.chapters.length, () => {
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

function nextPage() { goToPage(currentPage.value + 1) }
function prevPage() { goToPage(currentPage.value - 1) }

// 雷达图配置
const { el: radarEl } = useChart(() => {
  if (currentGroup.value.topics.length === 0) return null
  
  return {
    radar: {
      indicator: currentGroup.value.topics.map(item => ({
        name: item.name,
        max: item.max || 5
      })),
      radius: '65%',
      axisName: {
        color: chartTextColor(),
        fontSize: 10,
        overflow: 'truncate',
        width: 60
      },
      splitArea: {
        areaStyle: {
          color: ['rgba(59, 130, 246, 0.05)', 'rgba(59, 130, 246, 0.1)']
        }
      }
    },
    series: [{
      type: 'radar',
      data: [{
        value: currentGroup.value.topics.map(item => item.value),
        name: '掌握度',
        areaStyle: {
          color: (props.color || '#3b82f6') + '44'
        },
        lineStyle: {
          color: props.color || '#3b82f6',
          width: 2
        },
        itemStyle: {
          color: props.color || '#3b82f6'
        }
      }]
    }]
  }
}, [currentGroup])

// 统计信息
const stats = computed(() => {
  const values = currentGroup.value.topics.map(item => item.value)
  if (values.length === 0) return null
  
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const weak = currentGroup.value.topics.filter(item => item.value < 3)
  
  return { avg, min, max, weakCount: weak.length }
})

// 获取所有薄弱知识点（跨章节）
const allWeakTopics = computed(() => {
  const result: Array<{ topic: RadarDataItem; chapterName: string; pageIndex: number }> = []
  groups.value.forEach((group, idx) => {
    group.topics.forEach(topic => {
      if (topic.value < 3) {
        result.push({ topic, chapterName: group.chapterName, pageIndex: idx })
      }
    })
  })
  return result
})

const IMPORTANCE_META: Record<TopicImportance, { label: string; cls: string }> = {
  normal: { label: '普通', cls: 'text-slate-400 bg-slate-100 dark:bg-slate-700' },
  important: { label: '重要', cls: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30' },
  must: { label: '必考', cls: 'text-red-500 bg-red-50 dark:bg-red-900/30' }
}

/** 选中词条的详情数据（名称/掌握度/重要程度/章节） */
const selectedTopicDetail = computed(() => {
  const t = selectedTopic.value
  if (!t) return null
  const group = groups.value[t.pageIndex]
  const topic = group?.topics.find(x => x.name === t.name)
  if (!group || !topic) return null
  return {
    name: topic.name,
    value: topic.value,
    importance: topic.importance || 'normal',
    chapterName: group.chapterName
  }
})

function isTopicSelected(item: { topic: RadarDataItem; pageIndex: number }) {
  return selectedTopic.value?.name === item.topic.name && selectedTopic.value?.pageIndex === item.pageIndex
}
</script>

<template>
  <div class="enhanced-radar-chart">
    <!-- 标题和统计 -->
    <div v-if="title || stats" class="flex items-center justify-between mb-3">
      <h3 v-if="title" class="text-sm font-medium text-slate-700 dark:text-slate-300">
        {{ title }}
      </h3>
      <div v-if="stats" class="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>平均: <strong class="text-blue-600 dark:text-blue-400">{{ stats.avg.toFixed(1) }}</strong></span>
        <span>薄弱: <strong class="text-orange-600 dark:text-orange-400">{{ stats.weakCount }}</strong></span>
      </div>
    </div>

    <!-- 当前章节名称 -->
    <div v-if="hasMultiplePages" class="mb-2 text-center">
      <span class="inline-block px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium">
        {{ currentGroup.chapterName }}
      </span>
    </div>

    <!-- 雷达图 -->
    <div ref="radarEl" class="h-64 sm:h-72 md:h-80"></div>

    <!-- 分页控制 -->
    <div v-if="hasMultiplePages" class="mt-4 space-y-3">
      <!-- 页码指示器 -->
      <div class="flex items-center justify-center gap-2">
        <button
          @click="prevPage"
          :disabled="currentPage === 0"
          class="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
          aria-label="上一章">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>

        <div ref="navRef" class="relative flex gap-1.5 overflow-x-auto max-w-xs sm:max-w-md"
          @wheel.prevent="onNavWheel">
          <button
            v-for="(group, idx) in groups"
            :key="idx"
            @click="goToPage(idx)"
            :class="[
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
              currentPage === idx
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            ]"
            :title="group.chapterName"
            :aria-label="`${group.chapterName}`"
            :aria-current="currentPage === idx ? 'true' : undefined">
            {{ group.chapterName.length > 8 ? group.chapterName.slice(0, 8) + '...' : group.chapterName }}
          </button>
        </div>

        <button
          @click="nextPage"
          :disabled="currentPage === totalPages - 1"
          class="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
          aria-label="下一章">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <!-- 当前章节信息 -->
      <div class="text-center text-xs text-slate-500 dark:text-slate-400">
        第 {{ currentPage + 1 }} / {{ totalPages }} 章
        <span class="mx-1">·</span>
        本章 {{ currentGroup.topics.length }} 个知识点
        <span class="mx-1">·</span>
        共 {{ totalTopics }} 个知识点
      </div>

      <!-- 薄弱知识点快速跳转 -->
      <div v-if="allWeakTopics.length > 0" class="pt-2 border-t border-slate-200 dark:border-slate-700">
        <!-- 选中词条详情 -->
        <div v-if="selectedTopicDetail" class="mb-2 p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ selectedTopicDetail.name }}</div>
          <div class="flex items-center gap-2 mt-1">
            <StarRating :model-value="selectedTopicDetail.value" readonly />
            <span class="text-xs text-slate-500 dark:text-slate-400">{{ selectedTopicDetail.value }}/5</span>
          </div>
          <div class="flex items-center gap-1.5 mt-1.5">
            <span class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="IMPORTANCE_META[selectedTopicDetail.importance].cls">{{ IMPORTANCE_META[selectedTopicDetail.importance].label }}</span>
            <span class="text-xs text-slate-500 dark:text-slate-400">{{ selectedTopicDetail.chapterName }}</span>
          </div>
        </div>

        <div class="text-xs text-slate-500 dark:text-slate-400 mb-2">薄弱知识点 (掌握度 &lt; 3):</div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(item, idx) in allWeakTopics"
            :key="idx"
            @click="selectTopic({ name: item.topic.name, pageIndex: item.pageIndex })"
            :class="[
              'px-2 py-1 text-xs rounded transition-colors',
              isTopicSelected(item)
                ? 'ring-2 ring-orange-500 bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300'
                : currentPage === item.pageIndex
                  ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300'
                  : 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30'
            ]"
            :title="`${item.chapterName} - ${item.topic.name}`">
            {{ item.topic.name }}
          </button>
        </div>
      </div>
    </div>

    <!-- 无数据提示 -->
    <div v-if="totalTopics === 0" class="text-center py-8 text-sm text-slate-400">
      暂无掌握度数据
    </div>
  </div>
</template>

<style scoped>
.enhanced-radar-chart {
  @apply w-full;
}

/* 确保在小屏幕上也能良好显示 */
@media (max-width: 640px) {
  .enhanced-radar-chart :deep(.echarts-container) {
    font-size: 10px;
  }
}
</style>
