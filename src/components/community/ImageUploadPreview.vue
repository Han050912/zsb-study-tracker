<script setup lang="ts">
import type { PendingImage } from '../../composables/useImageUpload'

/**
 * 待上传图片预览列表：发帖 / 评论 / 私信三处共用（数据来自 useImageUpload）。
 * 布局由调用方通过 listClass / itemClass 指定；progress 切换进度展示（底部进度条 / 居中百分比）；
 * removable 控制右上角常驻删除按钮（失败态的「重试 / 移除」始终可用）；size 适配缩略图尺寸的文字档位。
 */
withDefaults(
  defineProps<{
    images: PendingImage[]
    /** 外层容器类（grid / flex 布局） */
    listClass?: string
    /** 单项缩略图容器类（尺寸 / 圆角 / 底色） */
    itemClass?: string
    /** 上传中进度展示：bar = 底部进度条；percent = 居中百分比遮罩 */
    progress?: 'bar' | 'percent'
    /** 是否展示右上角常驻删除按钮 */
    removable?: boolean
    /** 覆盖层文字与删除按钮尺寸档位（跟随缩略图大小） */
    size?: 'sm' | 'md'
  }>(),
  {
    listClass: '',
    itemClass: '',
    progress: 'bar',
    removable: true,
    size: 'sm'
  }
)

const emit = defineEmits<{ remove: [index: number]; retry: [index: number] }>()
</script>

<template>
  <div v-if="images.length" :class="listClass">
    <div v-for="(img, i) in images" :key="img.localUrl" :class="itemClass">
      <img
        :src="img.localUrl"
        class="w-full h-full object-cover"
        :class="{ 'opacity-50': progress === 'bar' && !img.url && !img.error }"
        alt="待发送图片"
      />
      <!-- 上传进度 -->
      <div
        v-if="progress === 'bar' && !img.url && !img.error"
        class="absolute inset-x-1 bottom-1 h-1 rounded bg-white/50"
      >
        <div
          class="h-full rounded bg-primary-500 transition-all"
          :style="{ width: `${Math.round(img.progress * 100)}%` }"
        ></div>
      </div>
      <div
        v-if="progress === 'percent' && img.progress < 1 && !img.error"
        class="absolute inset-0 bg-black/40 flex items-center justify-center text-[10px] text-white"
      >
        {{ Math.round(img.progress * 100) }}%
      </div>
      <!-- 失败态 -->
      <div
        v-if="img.error"
        class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-white/70 dark:bg-slate-900/70"
        :class="size === 'md' ? 'text-xs' : 'text-[10px]'"
      >
        <button class="text-red-500 font-medium" @click="emit('retry', i)">重试</button>
        <button class="text-slate-500" @click="emit('remove', i)">移除</button>
      </div>
      <!-- 删除 -->
      <button
        v-if="removable"
        class="absolute rounded-full bg-black/50 text-white leading-none"
        :class="size === 'md' ? 'top-1 right-1 w-5 h-5 text-xs' : 'top-0.5 right-0.5 w-4 h-4 text-[10px]'"
        @click="emit('remove', i)"
      >
        ×
      </button>
    </div>
  </div>
</template>
