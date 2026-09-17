<script setup lang="ts">
import { usePostDetail } from '../features/community/composables/usePostDetail'
import AsyncState from '../shared/components/AsyncState.vue'
import PostCard from '../components/community/PostCard.vue'
import CommentItem from '../components/community/CommentItem.vue'
import CommentInput from '../components/community/CommentInput.vue'
import Lightbox from '../components/community/Lightbox.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
const {
  post,
  loading,
  notFound,
  highlightCommentId,
  loadError,
  commentError,
  commentsLoading,
  commentCursor,
  replyCursors,
  replyErrors,
  replyLoading,
  loadPost,
  loadComments,
  retryComments,
  loadReplies,
  isMine,
  canDeletePost,
  commentSort,
  expandedReplies,
  toggleReplies,
  commentTree,
  likePost,
  likeComment,
  dislikePost,
  dislikeComment,
  replySource,
  commentInputRef,
  reply,
  cancelReply,
  commentSubmitting,
  send,
  removeComment,
  removePost,
  showLightbox,
  lightboxIndex,
  openLightbox,
  showReport,
  reportTarget,
  openReport,
  toggleResolve,
  acceptVisible,
  accept,
  showCommentLightbox,
  commentLightboxIndex,
  commentLightboxUrls,
  openCommentLightbox,
  showProfile,
  profileUserId,
  openProfile,
  togglePin,
  toggleFeature,
  toggleHidePost,
  toggleHideComment,
  goBack
} = usePostDetail()
</script>

<template>
  <div class="collaboration-page p-4 md:p-6 max-w-3xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2.5" @click="goBack">← 返回</button>
      <h1 class="page-title">帖子详情</h1>
    </div>

    <AsyncState v-if="loading || loadError" :loading="loading" :error="loadError" @retry="loadPost" />
    <div v-else-if="notFound" class="card text-center py-10 text-slate-400 text-sm">
      <p>帖子不存在或已被删除</p>
    </div>

    <template v-else-if="post">
      <PostCard
        :post="post"
        detail
        @like="likePost"
        @dislike="dislikePost"
        @pin="togglePin"
        @feature="toggleFeature"
        @hide="toggleHidePost"
        @image="openLightbox"
        @report="openReport('post', post.id)"
        @profile="openProfile(post.userId)"
      >
        <template #actions>
          <!-- 已采纳最佳答案时禁用手动标记（需先取消采纳），避免出现矛盾态 -->
          <button
            v-if="isMine && post.type === 'question' && !post.acceptedAnswerId"
            class="text-xs text-slate-400 hover:text-emerald-500"
            @click.stop="toggleResolve"
          >
            {{ post.isResolved ? '取消已解答' : '标记已解答' }}
          </button>
          <button v-if="canDeletePost" class="text-xs text-slate-400 hover:text-red-500" @click.stop="removePost">
            删除
          </button>
        </template>
      </PostCard>

      <!-- 评论区 -->
      <div class="card space-y-4">
        <div class="flex items-center justify-between">
          <div class="section-title !mb-0">评论 {{ post.commentsCount || '' }}</div>
          <div class="flex items-center gap-1 text-xs">
            <button
              class="px-2 py-1 rounded-md transition-colors"
              :class="
                commentSort === 'hot'
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium'
                  : 'text-slate-400 hover:text-slate-600'
              "
              @click="commentSort = 'hot'"
            >
              热度
            </button>
            <button
              class="px-2 py-1 rounded-md transition-colors"
              :class="
                commentSort === 'latest'
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium'
                  : 'text-slate-400 hover:text-slate-600'
              "
              @click="commentSort = 'latest'"
            >
              最新
            </button>
          </div>
        </div>

        <div
          v-if="!commentTree.length && !commentsLoading && !commentError"
          class="text-center text-xs text-slate-400 py-4"
        >
          暂无评论，来抢沙发～
        </div>
        <div v-for="c in commentTree" :key="c.id" :id="`comment-${c.id}`" class="space-y-3 scroll-mt-24">
          <CommentItem
            :comment="c"
            :show-accept="acceptVisible(c)"
            :post-author-id="post?.userId"
            :replying="replySource?.id === c.id"
            :highlight="highlightCommentId === c.id"
            @like="likeComment(c)"
            @dislike="dislikeComment(c)"
            @reply="reply(c)"
            @remove="removeComment(c)"
            @hide="toggleHideComment(c)"
            @report="openReport('comment', c.id)"
            @accept="accept(c)"
            @image="openCommentLightbox(c, $event)"
            @profile="openProfile(c.userId)"
          />
          <!-- 二级回复：默认折叠，点击展开（抖音式） -->
          <template v-if="c.replyCount || c.replies?.length">
            <button
              v-if="!expandedReplies.has(c.id)"
              class="text-xs text-slate-400 hover:text-primary-500 ml-11"
              @click="toggleReplies(c.id)"
            >
              展开 {{ c.replyCount ?? c.replies.length }} 条回复 ↓
            </button>
            <div v-else class="ml-11 space-y-3 border-l-2 border-slate-100 dark:border-slate-700 pl-3">
              <div v-for="r in c.replies" :key="r.id" :id="`comment-${r.id}`" class="scroll-mt-24">
                <CommentItem
                  :comment="r"
                  :post-author-id="post?.userId"
                  :replying="replySource?.id === r.id"
                  :highlight="highlightCommentId === r.id"
                  @like="likeComment(r)"
                  @dislike="dislikeComment(r)"
                  @reply="reply(r)"
                  @remove="removeComment(r)"
                  @hide="toggleHideComment(r)"
                  @report="openReport('comment', r.id)"
                  @image="openCommentLightbox(r, $event)"
                  @profile="openProfile(r.userId)"
                />
              </div>
              <p v-if="replyErrors[c.id]" role="status" class="text-sm text-red-500">{{ replyErrors[c.id] }}</p>
              <button
                v-if="!(c.id in replyCursors) || replyCursors[c.id] || replyErrors[c.id]"
                class="btn-ghost"
                :disabled="replyLoading[c.id]"
                @click="loadReplies(c.id)"
              >
                {{ replyErrors[c.id] ? '重试回复' : '更多回复' }}
              </button>
              <p v-if="replyLoading[c.id]" role="status" class="text-sm text-slate-500">正在加载回复…</p>
              <button class="text-xs text-slate-400 hover:text-primary-500" @click="toggleReplies(c.id)">
                收起回复 ↑
              </button>
            </div>
          </template>
        </div>
      </div>

      <AsyncState v-if="commentError" :error="commentError" @retry="retryComments" />
      <button v-if="commentCursor" class="btn-ghost w-full" :disabled="commentsLoading" @click="loadComments()">
        {{ commentsLoading ? '正在加载评论' : '加载更多评论' }}
      </button>
      <Lightbox v-model:show="showLightbox" v-model:index="lightboxIndex" :urls="post.imageUrls" />
      <Lightbox v-model:show="showCommentLightbox" v-model:index="commentLightboxIndex" :urls="commentLightboxUrls" />
      <ReportDialog v-model:show="showReport" :target-type="reportTarget.type" :target-id="reportTarget.id" />
      <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />

      <!-- 抖音式：评论输入框固定在视口底部（移动端避开底导航）；
           白色背景条在 max-w-2xl 内再缩进 页面padding+cardpadding，与评论区 card 同栏宽对齐
           （移动端 px-8=32，桌面 px-6=24），并加圆角与上阴影与 card 视觉协调 -->
      <div class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 z-20 pb-safe-bottom">
        <div class="w-full">
          <div
            class="px-4 py-2 bg-white dark:bg-slate-800 border-t border-x border-slate-100 dark:border-slate-700 rounded-t-2xl shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
          >
            <div v-if="replySource" class="flex items-center text-xs text-slate-400 mb-1.5">
              <span class="truncate">正在回复 @{{ replySource.userName }}</span>
              <button class="text-primary-500 ml-2 shrink-0" @click="cancelReply">取消</button>
            </div>
            <CommentInput
              ref="commentInputRef"
              :placeholder="replySource ? '写下你的回复…' : '写下你的评论…'"
              :submitting="commentSubmitting"
              @send="send"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
