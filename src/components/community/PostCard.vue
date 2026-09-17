<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronUp } from '@lucide/vue'
import type { CommunityPost, PostType } from '../../types'
import { levelOf } from '../../data/defaults'
import { fromNow } from '../../utils/date'
import { isAdmin, sessionUser } from '../../services/auth'
import { imageUrl } from '../../api/community'
const MarkdownContent = defineAsyncComponent(() => import('./MarkdownContent.vue'))
import UserAvatar from './UserAvatar.vue'
import TagBadge from './TagBadge.vue'
import PostSocialActions from './PostSocialActions.vue'
import RemoteImage from '../RemoteImage.vue'
const PostModerationMenu = defineAsyncComponent(() => import('./PostModerationMenu.vue'))

const props = withDefaults(defineProps<{ post: CommunityPost; detail?: boolean }>(), { detail: false })
const emit = defineEmits<{
  like: []
  dislike: []
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
/**
 * 详情页 Markdown 渲染（renderMarkdown 内部 html:false 转义原始 HTML 防 XSS）。
 * 两阶段：同步渲染立即可见（无公式场景即最终态）；含公式时异步加载 KaTeX chunk 后原地升级。
 */

// ---- 列表态正文折叠（详情页不参与）----
/** 是否已展开全文（仅列表态生效） */
const expanded = ref(false)
/** 折叠态正文是否超出截断行数：只在真的溢出时才给展开入口，避免出现点了没反应的死按钮 */
const overflow = ref(false)
/** 折叠态正文元素 */
const bodyEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

/** 量测折叠态溢出：line-clamp 下 clientHeight 为截断后高度、scrollHeight 为全文高度。
 *  展开态两者相等量不出溢出，故展开期间保持上次折叠量测的结果，收起后再量。 */
function measureOverflow() {
  const el = bodyEl.value
  if (!el || expanded.value) return
  overflow.value = el.scrollHeight > el.clientHeight + 1
}

/** 折叠行数随正文宽度变化（窗口缩放、侧栏折叠、组件复用换帖），跟随元素尺寸重算 */
watch(
  bodyEl,
  (el) => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (!el) return
    resizeObserver = new ResizeObserver(measureOverflow)
    resizeObserver.observe(el)
    measureOverflow()
  },
  { flush: 'post' }
)

/** 展开/收起；收起后必须重新量测（展开态量不出溢出） */
async function toggleExpanded() {
  expanded.value = !expanded.value
  if (!expanded.value) {
    await nextTick()
    measureOverflow()
  }
}

/** 组件复用换帖（列表刷新替换对象）时回到折叠态并重新量测 */
watch(
  () => props.post.content,
  async () => {
    expanded.value = false
    await nextTick()
    measureOverflow()
  }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <article
    class="card space-y-3"
    :class="[
      detail ? '' : 'cursor-pointer hover:shadow-md transition-shadow',
      post.isHidden ? 'opacity-50 border-2 border-red-300 dark:border-red-700' : ''
    ]"
    @click="!detail && emit('open')"
    :role="detail ? undefined : 'link'"
    :tabindex="detail ? undefined : 0"
    :aria-label="detail ? undefined : `阅读${post.userName}的帖子`"
    @keydown.enter.self="!detail && emit('open')"
  >
    <!-- 作者行 -->
    <div class="flex flex-wrap items-center gap-2.5">
      <div
        class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer min-h-11"
        role="button"
        tabindex="0"
        :aria-label="`查看${post.userName}的资料`"
        @click.stop="emit('profile')"
        @keydown.enter.stop="emit('profile')"
        @keydown.space.prevent.stop="emit('profile')"
      >
        <UserAvatar :name="post.userName" :avatar="post.userAvatar" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-semibold truncate hover:text-primary-500">{{ post.userName }}</span>
            <span
              v-if="post.userVerified"
              class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0"
              title="认证专家"
              >✓</span
            >
            <span
              v-if="isMine"
              class="text-xs leading-none px-1 py-0.5 rounded border shrink-0 border-slate-300 text-slate-500 dark:border-slate-500 dark:text-slate-400 font-medium"
              >我</span
            >
            <span
              class="text-xs px-1.5 py-0.5 rounded-full shrink-0"
              :style="{ background: level.color + '1a', color: level.color }"
            >
              {{ level.name }}学者
            </span>
          </div>
          <div class="text-xs text-slate-400">{{ fromNow(post.createdAt) }}</div>
        </div>
      </div>
      <!-- 状态徽章 -->
      <span
        v-if="post.refType === 'badge'"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
        >🎖 成就达成</span
      >
      <span
        v-if="post.isPinned"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
        >📌 置顶</span
      >
      <span
        v-if="post.isFeatured"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
        >🌟 精华</span
      >
      <span
        v-if="post.isDaily"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400"
        >📅 每日一题</span
      >
      <span
        v-if="post.isHidden"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        >已隐藏</span
      >
      <span
        v-if="post.isFlagged"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
        >待审核</span
      >
      <span
        v-if="post.type === 'question'"
        class="text-xs px-2 py-0.5 rounded-full shrink-0"
        :class="
          post.isResolved
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
        "
      >
        {{ post.isResolved ? '✅ 已解答' : '待解答' }}
      </span>
      <span class="text-xs px-2 py-0.5 rounded-full shrink-0" :class="meta.cls">{{ meta.label }}</span>
      <span
        v-if="post.circleName"
        class="text-xs px-2 py-0.5 rounded-full shrink-0 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"
        >{{ post.circleName }}</span
      >
    </div>

    <!-- 正文：列表页折叠为 4 行纯文本（溢出时才给展开/收起入口）；详情页 Markdown 富文本渲染（renderMarkdown 防 XSS） -->
    <template v-if="!detail">
      <p
        ref="bodyEl"
        class="text-sm whitespace-pre-wrap leading-relaxed break-words"
        :class="expanded ? '' : 'line-clamp-4'"
      >
        {{ post.content }}
      </p>
      <button
        v-if="overflow"
        type="button"
        class="inline-flex items-center gap-0.5 text-xs text-primary-500 hover:underline"
        :aria-expanded="expanded"
        @click.stop="toggleExpanded"
      >
        {{ expanded ? '收起' : '展开全文' }}
        <ChevronUp v-if="expanded" :size="12" />
        <ChevronDown v-else :size="12" />
      </button>
    </template>
    <MarkdownContent v-else :content="post.content" />

    <p v-if="!detail && ['share', 'longform'].includes(post.type)" class="text-xs text-slate-500">
      约 {{ Math.max(1, Math.ceil(post.content.length / 350)) }} 分钟阅读
    </p>
    <!-- 配图：列表页仅首图 16:9 裁剪缩略；详情页全部展示，点击进灯箱 -->
    <template v-if="post.imageUrls?.length">
      <div v-if="!detail" class="rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
        <RemoteImage
          :src="imageUrl(post.imageThumbs?.[0] || post.imageUrls[0])"
          loading="lazy"
          img-class="w-full aspect-video object-cover"
          alt="帖子配图"
        />
        <div v-if="post.imageUrls.length > 1" class="text-right text-xs text-slate-400 px-1 py-0.5">
          共 {{ post.imageUrls.length }} 张
        </div>
      </div>
      <div
        v-else
        class="grid gap-2"
        :class="post.imageUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'"
      >
        <RemoteImage
          v-for="(u, i) in post.imageUrls"
          :key="u"
          :src="imageUrl(u)"
          loading="lazy"
          img-class="w-full rounded-lg object-cover cursor-zoom-in aspect-square"
          alt="帖子配图"
          @open="emit('image', i)"
        />
      </div>
    </template>

    <!-- 标签 -->
    <div v-if="post.tags.length" class="flex flex-wrap gap-1.5">
      <TagBadge v-for="t in post.tags" :key="t" :tag="t" @click="emit('tag', t)" />
    </div>

    <!-- 互动行 -->
    <div class="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-50 dark:border-slate-700/50">
      <PostSocialActions :post="post" @like="emit('like')" @dislike="emit('dislike')" />
      <div class="ml-auto flex items-center gap-2" @click.stop>
        <!-- 管理员操作 -->
        <PostModerationMenu
          v-if="isAdmin"
          :post="post"
          @pin="emit('pin')"
          @feature="emit('feature')"
          @daily="emit('daily')"
          @hide="emit('hide')"
        />
        <button v-if="!isMine" class="text-xs text-slate-400 hover:text-orange-500" @click="emit('report')">
          举报
        </button>
        <slot name="actions" />
      </div>
    </div>
  </article>
</template>
