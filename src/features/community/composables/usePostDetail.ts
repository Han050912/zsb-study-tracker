import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { getErrorMessage } from '../../../utils/error'
import { useToast } from '../../../composables/useToast'
import { useConfirm } from '../../../composables/useConfirm'
import { useRoute, useRouter } from 'vue-router'
import { usePostStore } from '../../../stores/community'
import { postsApi } from '../../../api/community/posts'
import { sessionUser, isAdmin, requireLogin } from '../../../services/auth'
import type { CommunityComment } from '../../../types'
import { useBack } from '../../../composables/useBack'

export function usePostDetail() {
  const route = useRoute()
  const router = useRouter()
  const { goBack } = useBack()
  const store = usePostStore()
  const toast = useToast()
  const confirm = useConfirm()

  const postId = route.params.id as string
  const post = computed(() => store.postsById[postId] ?? null)
  const comments = computed({
    get: () => (store.commentIdsByPost[postId] ?? []).map((id) => store.commentsById[id]).filter(Boolean),
    set: (value) => store.setComments(postId, value)
  })
  const loading = ref(true)
  const notFound = ref(false)
  /** 通知跳转锚定的评论 id（经 ?comment= 查询参数进入），用于滚动定位与高亮 */
  const highlightCommentId = ref('')

  const loadError = ref(''),
    commentError = ref(''),
    commentsLoading = ref(false),
    commentCursor = ref<string | null>(null)
  let retryCommentRequest: () => Promise<void> = () => loadComments(true)
  const pendingComments = new Set<string>()
  const replyCursors = ref<Record<string, string | null>>({}),
    replyErrors = ref<Record<string, string>>({}),
    replyLoading = ref<Record<string, boolean>>({})
  let disposed = false,
    commentTicket = 0
  onBeforeUnmount(() => {
    disposed = true
    commentTicket++
  })
  onMounted(loadPost)
  async function loadPost() {
    loading.value = true
    loadError.value = ''
    notFound.value = false
    const generation = store.generation
    try {
      const d = await postsApi.post(postId, commentSort.value)
      if (disposed || generation !== store.generation) return
      store.upsert([d.post])
      comments.value = d.comments
      commentCursor.value = d.nextCursor ?? null
      loading.value = false
      const anchor = typeof route.query.comment === 'string' ? route.query.comment : ''
      if (anchor) {
        try {
          const around = await postsApi.comments(postId, { aroundCommentId: anchor })
          if (disposed || generation !== store.generation) return
          store.setComments(postId, around.comments, true)
          await anchorToComment(anchor)
        } catch (e) {
          if (!disposed) {
            commentError.value = getErrorMessage(e, '定位评论失败')
            retryCommentRequest = loadPost
          }
        }
      }
    } catch (e) {
      if (disposed) return
      notFound.value = [403, 404].includes((e as { status?: number }).status ?? 0)
      if (!notFound.value) loadError.value = getErrorMessage(e, '帖子加载失败')
    } finally {
      if (!disposed) loading.value = false
    }
  }
  async function loadComments(reset = false) {
    if (!reset && (commentsLoading.value || !commentCursor.value)) return
    const ticket = ++commentTicket,
      generation = store.generation
    commentsLoading.value = true
    commentError.value = ''
    retryCommentRequest = () => loadComments(reset)
    try {
      const res = await postsApi.comments(postId, {
        sort: commentSort.value,
        cursor: reset ? null : commentCursor.value
      })
      if (disposed || ticket !== commentTicket || generation !== store.generation) return
      store.setComments(postId, res.comments, !reset)
      commentCursor.value = res.nextCursor
      if (reset) {
        expandedReplies.value = new Set()
        replyCursors.value = {}
      }
    } catch (e) {
      if (ticket === commentTicket && !disposed) commentError.value = getErrorMessage(e, '评论加载失败')
    } finally {
      if (ticket === commentTicket) commentsLoading.value = false
    }
  }
  function retryComments() {
    return retryCommentRequest()
  }
  async function loadReplies(id: string) {
    if (replyLoading.value[id]) return
    const generation = store.generation
    replyLoading.value[id] = true
    replyErrors.value[id] = ''
    try {
      const res = await postsApi.comments(postId, { parentId: id, cursor: replyCursors.value[id] })
      if (disposed || generation !== store.generation) return
      store.setComments(postId, res.comments, true)
      replyCursors.value[id] = res.nextCursor
    } catch (e) {
      if (!disposed) replyErrors.value[id] = getErrorMessage(e, '回复加载失败')
    } finally {
      replyLoading.value[id] = false
    }
  }

  /** 滚动定位并高亮指定评论（通知跳转锚定；二级回复先展开其一级评论再定位；query reply=1 时自动进入回复态） */
  async function anchorToComment(id: string) {
    const c = findComment(id)
    if (!c) return
    if (c.parentId) expandedReplies.value = new Set([...expandedReplies.value, c.parentId])
    highlightCommentId.value = id
    await nextTick()
    document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (route.query.reply === '1') reply(c)
  }

  const isMine = computed(() => post.value?.userId === sessionUser.value?.id)
  const canDeletePost = computed(() => isMine.value || isAdmin.value)

  /** 评论排序：热度（默认，抖音习惯）或最新 */
  const commentSort = ref<'hot' | 'latest'>('hot')
  watch(commentSort, () => {
    void loadComments(true)
  })
  /** 已展开回复的一级评论 id 集合（二级回复默认折叠，抖音式） */
  const expandedReplies = ref(new Set<string>())
  function toggleReplies(id: string) {
    const s = new Set(expandedReplies.value)
    if (s.has(id)) s.delete(id)
    else {
      s.add(id)
      if (!(id in replyCursors.value)) void loadReplies(id)
    }
    expandedReplies.value = s
  }

  /** 一级评论 + 二级回复树（回复的 parentId 始终指向一级评论）；最佳答案置顶，其余按热度/时间排序 */
  const commentTree = computed(() => {
    const roots = comments.value.filter((c) => !c.parentId)
    const byParent = new Map<string, CommunityComment[]>()
    for (const c of comments.value) {
      if (!c.parentId) continue
      const list = byParent.get(c.parentId) || []
      list.push(c)
      byParent.set(c.parentId, list)
    }
    const accepted = roots.filter((c) => c.isAccepted)
    const others = roots.filter((c) => !c.isAccepted)
    others.sort((a, b) =>
      commentSort.value === 'hot' ? b.likesCount - a.likesCount || b.createdAt - a.createdAt : b.createdAt - a.createdAt
    )
    return [...accepted, ...others].map((r) => ({ ...r, replies: byParent.get(r.id) || [] }))
  })

  function findComment(id: string): CommunityComment | undefined {
    return comments.value.find((c) => c.id === id)
  }

  // ---- 点赞 ----
  async function likePost() {
    if (requireLogin(router)) return
    if (!post.value) return
    const liked = await store.likePost(postId).catch((e) => {
      toast(getErrorMessage(e, '操作失败'))
      return null
    })
    if (liked === null) return
  }

  async function likeComment(c: CommunityComment) {
    if (requireLogin(router)) return
    if (pendingComments.has(c.id)) return
    pendingComments.add(c.id)
    const liked = await store.likeComment(c.id).catch((e) => {
      toast(getErrorMessage(e, '操作失败'))
      return null
    })
    pendingComments.delete(c.id)
    if (liked === null || disposed) return
    // 一级评论在 commentTree 中被展开为副本（携带 replies），必须更新原始数组中的对象
    const target = findComment(c.id)
    if (target) {
      target.likedByMe = liked
      target.likesCount = Math.max(0, target.likesCount + (liked ? 1 : -1))
      if (liked && target.dislikedByMe) {
        target.dislikedByMe = false
        target.dislikesCount = Math.max(0, target.dislikesCount - 1)
      }
    }
  }

  // ---- 踩 ----
  async function dislikePost() {
    if (requireLogin(router)) return
    if (!post.value) return
    const res = await store.dislikePost(postId).catch((e) => {
      toast(getErrorMessage(e, '操作失败'))
      return null
    })
    if (res === null) return
  }

  async function dislikeComment(c: CommunityComment) {
    if (requireLogin(router)) return
    if (pendingComments.has(c.id)) return
    pendingComments.add(c.id)
    const res = await store.dislikeComment(c.id).catch((e) => {
      toast(getErrorMessage(e, '操作失败'))
      return null
    })
    pendingComments.delete(c.id)
    if (res === null || disposed) return
    const target = findComment(c.id)
    if (target) {
      target.dislikedByMe = res.disliked
      target.dislikesCount = Math.max(0, target.dislikesCount + (res.disliked ? 1 : -1))
      if (res.likeRevoked) {
        target.likedByMe = false
        target.likesCount = Math.max(0, target.likesCount - 1)
      }
    }
  }

  // ---- 评论 / 回复 ----
  /** 发送时的 parentId（回复二级评论时仍指向其一级评论，最多二级） */
  const replyTarget = ref<CommunityComment | null>(null)
  /** 用户实际点击的评论（用于高亮锚定与「正在回复 @xxx」提示） */
  const replySource = ref<CommunityComment | null>(null)
  const commentInputRef = ref<{ focus: () => void; reset: () => void } | null>(null)

  function reply(c: CommunityComment) {
    if (requireLogin(router)) return
    // 重复点击同一条评论：保持现有回复状态，不重置输入
    if (replySource.value?.id === c.id) return
    replySource.value = c
    replyTarget.value = c.parentId ? findComment(c.parentId) || c : c
    // 聚焦输入框，用户直接输入回复内容（不再自动填入 @用户名）
    commentInputRef.value?.focus()
  }

  function cancelReply() {
    replyTarget.value = null
    replySource.value = null
  }

  /** 评论提交中：承载 AI 复审约 1-3s 延迟，禁用发送按钮防重复提交 */
  const commentSubmitting = ref(false)

  async function send(text: string, imageUrls: string[]) {
    if (requireLogin(router)) return
    if (commentSubmitting.value) return
    commentSubmitting.value = true
    try {
      const c = await store.postComment(postId, text, replyTarget.value?.id, imageUrls)
      if (disposed) return
      store.setComments(postId, [c], true)
      if (c.parentId && store.commentsById[c.parentId])
        store.commentsById[c.parentId].replyCount = (store.commentsById[c.parentId].replyCount ?? 0) + 1
      replyTarget.value = null
      replySource.value = null
      // 发送成功后清空输入框（失败时保留用户输入，避免重打内容）
      commentInputRef.value?.reset()
    } catch (e) {
      toast(getErrorMessage(e, '评论失败'))
    } finally {
      commentSubmitting.value = false
    }
  }

  async function removeComment(c: CommunityComment) {
    if (!(await confirm('确认删除这条评论？', { danger: true }))) return
    const removed = 1 + (c.replyCount ?? c.replies?.length ?? 0)
    try {
      await store.removeComment(c.id, postId, removed)
      // 本地移除该评论及其回复
      const ids = new Set([c.id, ...(c.replies?.map((r) => r.id) ?? [])])
      if (c.parentId && store.commentsById[c.parentId])
        store.commentsById[c.parentId].replyCount = Math.max(0, (store.commentsById[c.parentId].replyCount ?? 0) - 1)
      comments.value = comments.value.filter((x) => !ids.has(x.id) && x.parentId !== c.id)
      // 删除的若为最佳答案：服务端级联已解除采纳并回退为待解答，本地同步（含广场列表副本）
      if (c.isAccepted && post.value) {
        post.value.acceptedAnswerId = undefined
        post.value.isResolved = false
      }
    } catch (e) {
      toast(getErrorMessage(e, '删除失败'))
    }
  }

  // ---- 删帖 ----
  async function removePost() {
    if (!(await confirm('确认删除这篇帖子？评论和点赞将一并删除。', { danger: true }))) return
    try {
      await store.removePost(postId)
      toast('帖子已删除')
      router.replace('/community')
    } catch (e) {
      toast(getErrorMessage(e, '删除失败'))
    }
  }

  // ---- 图片灯箱 ----
  const showLightbox = ref(false)
  const lightboxIndex = ref(0)
  function openLightbox(i: number) {
    lightboxIndex.value = i
    showLightbox.value = true
  }

  // ---- 举报 ----
  const showReport = ref(false)
  const reportTarget = ref<{ type: 'post' | 'comment'; id: string }>({ type: 'post', id: '' })
  function openReport(type: 'post' | 'comment', id: string) {
    if (requireLogin(router)) return
    reportTarget.value = { type, id }
    showReport.value = true
  }

  // ---- 提问帖标记解决 ----
  async function toggleResolve() {
    if (requireLogin(router)) return
    if (!post.value) return
    try {
      const { isResolved } = await postsApi.resolvePost(postId)
      post.value.isResolved = isResolved
      toast(isResolved ? '已标记为已解答' : '已重新开放为待解答')
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    }
  }

  // ---- 最佳答案采纳（仅提问帖楼主；仅一级评论；不能采纳自己的评论） ----
  const canAccept = computed(
    () => !!post.value && post.value.type === 'question' && isMine.value && !post.value.isHidden
  )

  function acceptVisible(c: CommunityComment) {
    return canAccept.value && !c.parentId && !c.isHidden && c.userId !== sessionUser.value?.id
  }

  const accepting = ref(false) // 采纳请求在途标记：防止双击并发采纳导致积分重复发放

  async function accept(c: CommunityComment) {
    if (requireLogin(router)) return
    if (!post.value || accepting.value) return
    const current = post.value.acceptedAnswerId
    if (current === c.id) {
      if (!(await confirm('取消采纳这条最佳答案？双方将扣除相应积分。'))) return
    } else if (current) {
      if (!(await confirm('改采纳这条评论？原最佳答案的采纳将被撤销。'))) return
    } else {
      if (!(await confirm(`采纳 @${c.userName} 的回答为最佳答案？对方 +10 积分，你 +3 积分。`))) return
    }
    accepting.value = true
    try {
      const res = await store.acceptAnswer(postId, c.id)
      // 同步评论标记：旧采纳清除，新采纳置位（commentTree 为展开副本，必须改原始数组）
      toast(res.acceptedAnswerId ? '已采纳最佳答案' : '已取消采纳，帖子重新开放为待解答')
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    } finally {
      accepting.value = false
    }
  }

  // ---- 评论图片灯箱 ----
  const showCommentLightbox = ref(false)
  const commentLightboxIndex = ref(0)
  const commentLightboxUrls = ref<string[]>([])
  function openCommentLightbox(c: CommunityComment, i: number) {
    commentLightboxUrls.value = c.imageUrls
    commentLightboxIndex.value = i
    showCommentLightbox.value = true
  }

  // ---- 用户资料卡 ----
  const showProfile = ref(false)
  const profileUserId = ref('')
  function openProfile(userId: string) {
    // 资料卡后端公开（auth:false）；访客可见性由弹窗内 401 引导处理
    profileUserId.value = userId
    showProfile.value = true
  }

  // ---- 管理员操作 ----
  async function togglePin() {
    if (!post.value) return
    try {
      const pinned = await store.adminPinPost(postId)
      toast(pinned ? '已置顶' : '已取消置顶')
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    }
  }

  async function toggleFeature() {
    if (!post.value) return
    try {
      const featured = await store.adminFeaturePost(postId)
      toast(featured ? '已加精' : '已取消加精')
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    }
  }

  async function toggleHidePost() {
    if (!post.value) return
    try {
      const hidden = await store.adminHidePost(postId)
      toast(hidden ? '已隐藏' : '已取消隐藏')
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    }
  }

  async function toggleHideComment(c: CommunityComment) {
    try {
      const hidden = await store.adminHideComment(c.id)
      const target = findComment(c.id)
      if (target) target.isHidden = hidden
      toast(hidden ? '评论已隐藏' : '评论已恢复')
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    }
  }

  return {
    route,
    router,
    store,
    toast,
    confirm,
    postId,
    post,
    comments,
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
    disposed,
    commentTicket,
    loadPost,
    loadComments,
    retryComments,
    loadReplies,
    anchorToComment,
    isMine,
    canDeletePost,
    commentSort,
    expandedReplies,
    toggleReplies,
    commentTree,
    findComment,
    likePost,
    likeComment,
    dislikePost,
    dislikeComment,
    replyTarget,
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
    canAccept,
    acceptVisible,
    accepting,
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
  }
}
