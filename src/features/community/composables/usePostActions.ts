import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePostStore } from '../../../stores/community'
import { useToast } from '../../../composables/useToast'
import { useConfirm } from '../../../composables/useConfirm'
import { requireLogin } from '../../../services/auth'
import { getErrorMessage } from '../../../utils/error'

export function usePostActions() {
  const store = usePostStore(),
    router = useRouter(),
    toast = useToast(),
    confirm = useConfirm()
  const showProfile = ref(false),
    profileUserId = ref(''),
    showReport = ref(false),
    reportPostId = ref('')
  function openProfile(id: string) {
    profileUserId.value = id
    showProfile.value = true
  }
  function openReport(id: string) {
    if (requireLogin(router)) return
    reportPostId.value = id
    showReport.value = true
  }
  async function action(kind: 'like' | 'dislike' | 'pin' | 'feature' | 'daily' | 'hide' | 'remove', id: string) {
    if (requireLogin(router)) return
    if (kind === 'remove' && !(await confirm('确认删除这篇帖子？评论和点赞将一并删除。', { danger: true }))) return
    const commands = {
      like: store.likePost,
      dislike: store.dislikePost,
      pin: store.adminPinPost,
      feature: store.adminFeaturePost,
      daily: store.adminDailyPost,
      hide: store.adminHidePost,
      remove: store.removePost
    }
    try {
      await commands[kind](id)
    } catch (e) {
      toast(getErrorMessage(e, '操作失败'))
    }
  }
  return { action, showProfile, profileUserId, showReport, reportPostId, openProfile, openReport }
}
