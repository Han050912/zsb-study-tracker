<script setup lang="ts">
import { computed } from 'vue'
import type { CommunityPost, PostType } from '../../types'
import { levelOf } from '../../data/defaults'
import { fromNow } from '../../utils/date'
import { isAdmin, sessionUser } from '../../services/auth'
import { imageUrl } from '../../api/community'
import { renderMarkdown } from '../../utils/markdown'
import UserAvatar from './UserAvatar.vue'
import TagBadge from './TagBadge.vue'
import LikeButton from './LikeButton.vue'

const props = withDefaults(defineProps<{ post: CommunityPost; detail?: boolean }>(), { detail: false })
const emit = defineEmits<{
  like: []
  tag: [tag: string]
  open: []
  pin: []
  feature: []
  daily: []
  hide: []
  remove: []
  report: []
  /** 点击作者头像/昵称：打开用户资料卡 */
  profile: []
  /** 详情页点击图片：灯箱预览（参数为图片下标） */
  image: [index: number]
}>()

const TYPE_META: Record<PostType, { label: string; cls: string }> = {
  checkin: { label: '打卡动态', cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' },
  share: { label: '经验分享', cls: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
  achievement: { label: '成就展示', cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
  longform: { label: '经验长文', cls: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
  question: { label: '提问', cls: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' }
}

const level = computed(() => levelOf(props.post.userPoints))
const meta = computed(() => TYPE_META[props.post.type] || TYPE_META.share)
const isMine = computed(() => props.post.userId === sessionUser.value?.id)
/** 详情页 Markdown 渲染（renderMarkdown 内部 html:false 转义原始 HTML + KaTeX 公式） */
const contentHtml = computed(() => renderMarkdown(props.post.content))
</script>

<template>
  <article class="card space-y-3" :class="[
    detail ? '' : 'cursor-pointer hover:shadow-md transition-shadow',
    post.isHidden ? 'opacity-50 border-2 border-red-300 dark:border-red-700' : ''
  ]" @click="!detail && emit('open')">
    <!-- 作者行 -->
    <div class="flex items-center gap-2.5">
      <div class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer" @click.stop="emit('profile')">
        <UserAvatar :name="post.userName" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-semibold truncate hover:text-primary-500">{{ post.userName }}</span>
            <span v-if="post.userVerified"
              class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0"
              title="认证专家">✓</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" :style="{ background: level.color + '1a', color: level.color }">
              {{ level.name }}学者
            </span>
          </div>
          <div class="text-[10px] text-slate-400">{{ fromNow(post.createdAt) }}</div>
        </div>
      </div>
      <!-- 状态徽章 -->
      <span v-if="post.isPinned" class="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">📌 置顶</span>
      <span v-if="post.isFeatured" class="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">🌟 精华</span>
      <span v-if="post.isDaily" class="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">📅 每日一题</span>
      <span v-if="post.isHidden" class="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">已隐藏</span>
      <span v-if="post.type === 'question'"
        class="text-[10px] px-2 py-0.5 rounded-full shrink-0"
        :class="post.isResolved
          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
          : 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'">
        {{ post.isResolved ? '✅ 已解答' : '❓ 待解答' }}
      </span>
      <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" :class="meta.cls">{{ meta.label }}</span>
      <span v-if="post.circleName" class="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400">🫧 {{ post.circleName }}</span>
    </div>

    <!-- 正文：列表页纯文本截断预览；详情页 Markdown 富文本渲染（renderMarkdown 防 XSS） -->
    <p v-if="!detail" class="text-sm whitespace-pre-wrap leading-relaxed break-words">{{ post.content }}</p>
    <div v-else class="text-sm md-body break-words" v-html="contentHtml"></div>

    <!-- 配图：列表页仅首图 16:9 裁剪缩略；详情页全部展示，点击进灯箱 -->
    <template v-if="post.imageUrls?.length">
      <div v-if="!detail" class="rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
        <img :src="imageUrl(post.imageUrls[0])" loading="lazy"
          class="w-full aspect-video object-cover" alt="帖子配图" />
        <div v-if="post.imageUrls.length > 1"
          class="text-right text-[10px] text-slate-400 px-1 py-0.5">共 {{ post.imageUrls.length }} 张</div>
      </div>
      <div v-else class="grid gap-2" :class="post.imageUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'">
        <img v-for="(u, i) in post.imageUrls" :key="u" :src="imageUrl(u)" loading="lazy"
          class="w-full rounded-lg object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
          :class="post.imageUrls.length === 1 ? 'max-h-[480px]' : 'aspect-square'"
          alt="帖子配图" @click.stop="emit('image', i)" />
      </div>
    </template>

    <!-- 标签 -->
    <div v-if="post.tags.length" class="flex flex-wrap gap-1.5">
      <TagBadge v-for="t in post.tags" :key="t" :tag="t" @click="emit('tag', t)" />
    </div>

    <!-- 互动行 -->
    <div class="flex items-center gap-5 pt-1 border-t border-slate-50 dark:border-slate-700/50">
      <LikeButton :liked="post.likedByMe" :count="post.likesCount" @toggle="emit('like')" />
      <span class="inline-flex items-center gap-1 text-xs text-slate-400">
        💬 <span>{{ post.commentsCount || '' }}</span>
      </span>
      <div class="ml-auto flex items-center gap-2" @click.stop>
        <!-- 管理员操作 -->
        <template v-if="isAdmin">
          <button class="text-xs text-slate-400 hover:text-amber-500" @click="emit('pin')">
            {{ post.isPinned ? '取消置顶' : '置顶' }}
          </button>
          <button class="text-xs text-slate-400 hover:text-violet-500" @click="emit('feature')">
            {{ post.isFeatured ? '取消加精' : '加精' }}
          </button>
          <button class="text-xs text-slate-400 hover:text-primary-500" @click="emit('daily')">
            {{ post.isDaily ? '取消一题' : '每日一题' }}
          </button>
          <button class="text-xs text-slate-400 hover:text-red-500" @click="emit('hide')">
            {{ post.isHidden ? '取消隐藏' : '隐藏' }}
          </button>
        </template>
        <button v-if="!isMine" class="text-xs text-slate-400 hover:text-orange-500" @click="emit('report')">举报</button>
        <slot name="actions" />
      </div>
    </div>
  </article>
</template>
