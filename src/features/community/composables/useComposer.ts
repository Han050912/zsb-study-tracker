import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '../../../utils/error'
import { useToast } from '../../../composables/useToast'
import { useConfirm } from '../../../composables/useConfirm'
import { useImageUpload } from '../../../composables/useImageUpload'
import { usePostStore } from '../../../stores/community'
import { COMMUNITY_TAGS } from '../../../data/defaults'
import { circlesApi } from '../../../api/community/circles'
import { IMAGE_MAX_PER_POST } from '../../../api/community'
import { sessionUser } from '../../../services/auth'
import { imageUrl } from '../../../api/community'
import type { CommunityCircle, PostType } from '../../../types'
export interface ComposerProps {
  show: boolean
  type: PostType
  presetContent: string
  presetTags: string[]
  /** 指定发到圈子（圈子详情页发帖入口）；不传则展示圈子选择器（可选发广场） */
  circleId?: string
  /** 知识点讨论帖归属（'subjectId|chapterName'，与 circleId 互斥） */
  topicRef?: string
  refType?: string
  refId?: string
  /** 允许在「分享 / 提问」之间切换（仅广场主发帖入口开启） */
  allowTypeSwitch?: boolean
  /** 允许填入「经验帖」结构化模板（仅广场主发帖入口开启） */
  allowTemplate?: boolean
}
export function useComposer(props: ComposerProps, emit: (event: 'update:show' | 'posted', value?: boolean) => void) {
  const store = usePostStore()
  const toast = useToast()
  const confirm = useConfirm()

  /** 提问帖必选的科目标签（与服务端 QUESTION_SUBJECT_TAGS 一致） */
  const QUESTION_SUBJECT_TAGS = ['#高等数学', '#英语']
  const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

  const {
    images,
    uploading,
    hasError,
    fileInput,
    pickImages,
    onFileChange,
    onPaste,
    onDrop,
    removeImage,
    retryImage,
    reset
  } = useImageUpload(IMAGE_MAX_PER_POST)

  const postType = ref<PostType>('share')
  const content = ref('')
  const tags = ref<string[]>([])
  /** 提问帖科目标签（单选） */
  const subject = ref('')
  const submitting = ref(false)

  /** 我的活跃圈子（广场发帖时可选发入圈内） */
  const myCircles = ref<CommunityCircle[]>([])
  /** 选中的圈子（'' = 发广场） */
  const selectedCircle = ref('')

  watch(
    () => props.show,
    async (v) => {
      if (v && props.circleId === undefined && !myCircles.value.length) {
        try {
          const res = await circlesApi.circles()
          myCircles.value = res.circles.filter((c) => c.myStatus === 'owner' || c.myStatus === 'member')
        } catch {
          /* 圈子列表加载失败不阻塞发帖 */
        }
      }
    },
    { immediate: true }
  )

  const closePrompt = ref(false)
  function draftKey() {
    return (
      'community-draft:' +
      (sessionUser.value?.id ?? 'guest') +
      ':' +
      (props.circleId || props.topicRef || props.refId || 'square')
    )
  }
  function restoreDraft() {
    if (props.presetContent) return
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey()) || 'null')
      if (!draft || typeof draft.content !== 'string' || !Array.isArray(draft.tags)) return
      content.value = draft.content
      tags.value = draft.tags.filter((v: unknown) => typeof v === 'string').slice(0, 5)
      postType.value = ['share', 'question', 'longform', 'checkin', 'achievement'].includes(draft.type)
        ? draft.type
        : props.type
      subject.value = typeof draft.subject === 'string' ? draft.subject : ''
      selectedCircle.value = typeof draft.circle === 'string' ? draft.circle : ''
      images.value = (Array.isArray(draft.images) ? draft.images : [])
        .filter((url: unknown) => typeof url === 'string' && url.startsWith('/api/'))
        .slice(0, IMAGE_MAX_PER_POST)
        .map((url: string) => ({ url, localUrl: imageUrl(url), progress: 1 }))
    } catch {
      /* 存储不可用时仍可正常编辑 */
    }
  }
  function requestClose() {
    if (submitting.value) return
    if (content.value.trim() || images.value.length) closePrompt.value = true
    else emit('update:show', false)
  }
  function closeWithDraft(keep: boolean) {
    try {
      if (keep)
        localStorage.setItem(
          draftKey(),
          JSON.stringify({
            content: content.value,
            tags: tags.value,
            type: postType.value,
            subject: subject.value,
            circle: selectedCircle.value,
            images: images.value.filter((i) => i.url).map((i) => i.url)
          })
        )
      else localStorage.removeItem(draftKey())
    } catch {
      if (keep) {
        toast('草稿保存失败，请复制内容后再关闭')
        return
      }
    }
    closePrompt.value = false
    emit('update:show', false)
  }

  const isQuestion = computed(() => postType.value === 'question')
  const placeholder = computed(() =>
    isQuestion.value
      ? '请描述题目来源、你的思路和卡住的地方…（可贴题目截图）'
      : '分享你的学习动态…（支持 emoji，可配图）'
  )

  watch(
    () => props.show,
    (v) => {
      if (v) {
        postType.value = props.type
        content.value = props.presetContent
        tags.value = [...props.presetTags]
        subject.value = QUESTION_SUBJECT_TAGS.find((t) => props.presetTags.includes(t)) ?? ''
        images.value = []
        selectedCircle.value = props.circleId ?? ''
        restoreDraft()
      } else {
        reset()
      }
    },
    { immediate: true }
  )

  /** 经验帖结构化模板文案（科目/方法/心得/建议四段） */
  const EXPERIENCE_TEMPLATE = ['科目：', '学习方法：', '心得体会：', '给后来人的建议：'].join('\n')

  async function applyExperienceTemplate() {
    if (content.value.trim() && !(await confirm('替换当前内容为经验帖模板？', { danger: true }))) return
    content.value = EXPERIENCE_TEMPLATE
    if (!tags.value.includes('#升本经验') && tags.value.length < 5) tags.value.push('#升本经验')
  }

  function switchType(t: PostType) {
    postType.value = t
    // 切到提问模式时，把通用标签里的科目标签收编到单选框
    if (t === 'question') {
      const found = tags.value.find((x) => QUESTION_SUBJECT_TAGS.includes(x))
      if (found) {
        subject.value = found
        tags.value = tags.value.filter((x) => !QUESTION_SUBJECT_TAGS.includes(x))
      }
    } else if (subject.value) {
      if (!tags.value.includes(subject.value) && tags.value.length < 5) tags.value.push(subject.value)
      subject.value = ''
    }
  }

  function toggleTag(t: string) {
    const i = tags.value.indexOf(t)
    if (i >= 0) {
      tags.value.splice(i, 1)
      return
    }
    // 提问帖的科目标签占一个名额（服务端共限 5 个），故通用标签最多 4 个
    const max = isQuestion.value && subject.value ? 4 : 5
    if (tags.value.length < max) tags.value.push(t)
    else toast('最多选择 5 个标签')
  }

  // ---------- 提交 ----------

  async function submit() {
    const text = content.value.trim()
    // 图文至少一项（支持纯图片发帖）
    if (!text && !images.value.length) {
      toast('请输入内容或添加图片')
      return
    }
    if (isQuestion.value && !subject.value) {
      toast('提问帖请选择科目标签')
      return
    }
    if (hasError.value) {
      toast('存在上传失败的图片，请移除或重试')
      return
    }
    if (uploading.value) {
      toast('图片上传中，请稍候')
      return
    }
    const finalTags = isQuestion.value ? [subject.value, ...tags.value] : tags.value
    submitting.value = true
    try {
      await store.publishPost({
        type: postType.value,
        content: text,
        tags: finalTags,
        imageUrls: images.value.map((i) => i.url!),
        circleId: props.topicRef ? undefined : selectedCircle.value || undefined,
        topicRef: props.topicRef,
        refType: props.refType,
        refId: props.refId
      })
      try {
        localStorage.removeItem(draftKey())
      } catch {
        /* 不阻塞发布结果 */
      }
      toast(props.topicRef ? '已发布到讨论区' : '已发布到社区广场')
      emit('update:show', false)
      emit('posted')
    } catch (e) {
      toast(getErrorMessage(e, '发布失败，请稍后再试'))
    } finally {
      submitting.value = false
    }
  }

  return {
    QUESTION_SUBJECT_TAGS,
    IMAGE_ACCEPT,
    images,
    uploading,
    fileInput,
    pickImages,
    onFileChange,
    onPaste,
    onDrop,
    removeImage,
    retryImage,
    content,
    tags,
    subject,
    submitting,
    myCircles,
    selectedCircle,
    closePrompt,
    requestClose,
    closeWithDraft,
    isQuestion,
    placeholder,
    applyExperienceTemplate,
    switchType,
    toggleTag,
    submit,
    IMAGE_MAX_PER_POST,
    COMMUNITY_TAGS
  }
}
