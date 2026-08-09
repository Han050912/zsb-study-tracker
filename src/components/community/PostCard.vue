<script setup lang="ts">
import { computed } from 'vue'
import type { CommunityPost, PostType } from '../../types'
import { levelOf } from '../../data/defaults'
import { fromNow } from '../../utils/date'
import UserAvatar from './UserAvatar.vue'
import TagBadge from './TagBadge.vue'
import LikeButton from './LikeButton.vue'

const props = withDefaults(defineProps<{ post: CommunityPost; detail?: boolean }>(), { detail: false })
const emit = defineEmits<{ like: []; tag: [tag: string]; open: [] }>()

const TYPE_META: Record<PostType, { label: string; cls: string }> = {
  checkin: { label: '打卡动态', cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' },
  share: { label: '经验分享', cls: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
  achievement: { label: '成就展示', cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
  longform: { label: '经验长文', cls: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' }
}

const level = computed(() => levelOf(props.post.userPoints))
const meta = computed(() => TYPE_META[props.post.type] || TYPE_META.share)
</script>

<template>
  <article class="card space-y-3" :class="detail ? '' : 'cursor-pointer hover:shadow-md transition-shadow'" @click="!detail && emit('open')">
    <!-- 作者行 -->
    <div class="flex items-center gap-2.5">
      <UserAvatar :name="post.userName" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold truncate">{{ post.userName }}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" :style="{ background: level.color + '1a', color: level.color }">
            {{ level.name }}学者
          </span>
        </div>
        <div class="text-[10px] text-slate-400">{{ fromNow(post.createdAt) }}</div>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" :class="meta.cls">{{ meta.label }}</span>
    </div>

    <!-- 正文 -->
    <p class="text-sm whitespace-pre-wrap leading-relaxed break-words">{{ post.content }}</p>

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
      <slot name="actions" />
    </div>
  </article>
</template>
