<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import TagBadge from './TagBadge.vue'
import { useCommunityStore } from '../../stores/community'
import { COMMUNITY_TAGS } from '../../data/defaults'
import { communityApi, uploadImage, IMAGE_MAX_BYTES, IMAGE_MAX_PER_POST } from '../../api/community'
import { renderMarkdown } from '../../utils/markdown'
import type { CommunityCircle, PostType } from '../../types'

/**
 * 发帖/分享编辑器：普通发帖、提问帖与各页面「分享到广场」共用。
 * 打开时（show 变为 true）以 preset 内容重置表单。
 * 图片支持点击选择 / 拖拽 / Ctrl+V 粘贴三种方式，上传中展示进度条（XHR upload progress）。
 * Markdown：工具栏插入粗体/代码/代码块/引用/列表/公式语法，编辑/预览 Tab 切换（KaTeX 渲染）。
 * circleId 传入时发到圈子（仅成员）；未传入且用户有已加入圈子时展示圈子选择器。
 */
const props = withDefaults(defineProps<{
  show: boolean
  type: PostType
  presetContent?: string
  presetTags?: string[]
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
}>(), { presetContent: '', presetTags: () => [], circleId: undefined, topicRef: undefined, refType: undefined, refId: undefined, allowTypeSwitch: false, allowTemplate: false })

const emit = defineEmits<{ 'update:show': [boolean]; posted: [] }>()

const store = useCommunityStore()
const toast = inject<(m: string) => void>('toast', () => {})

/** 提问帖必选的科目标签（与服务端 QUESTION_SUBJECT_TAGS 一致） */
const QUESTION_SUBJECT_TAGS = ['#高等数学', '#英语']
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

interface PendingImage {
  /** 本地预览地址（blob:） */
  localUrl: string
  file?: File
  /** 上传完成后的服务端路径 */
  url?: string
  /** 0-1 上传进度 */
  progress: number
  error?: string
}

const postType = ref<PostType>('share')
const content = ref('')
const tags = ref<string[]>([])
/** 提问帖科目标签（单选） */
const subject = ref('')
const images = ref<PendingImage[]>([])
const submitting = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** Markdown 预览开关 */
const preview = ref(false)
const previewHtml = computed(() => renderMarkdown(content.value))

/** 我的活跃圈子（广场发帖时可选发入圈内） */
const myCircles = ref<CommunityCircle[]>([])
/** 选中的圈子（'' = 发广场） */
const selectedCircle = ref('')

watch(() => props.show, async v => {
  if (v && props.circleId === undefined && !myCircles.value.length) {
    try {
      const res = await communityApi.circles()
      myCircles.value = res.circles.filter(c => c.myStatus === 'owner' || c.myStatus === 'member')
    } catch { /* 圈子列表加载失败不阻塞发帖 */ }
  }
})

const isQuestion = computed(() => postType.value === 'question')
/** 存在未完成的图片上传时禁止提交 */
const uploading = computed(() => images.value.some(i => !i.url && !i.error))
const placeholder = computed(() => isQuestion.value
  ? '请描述题目来源、你的思路和卡住的地方…（可贴题目截图）'
  : '分享你的学习动态…（支持 emoji，可配图）')

watch(() => props.show, v => {
  if (v) {
    postType.value = props.type
    content.value = props.presetContent
    tags.value = [...props.presetTags]
    subject.value = QUESTION_SUBJECT_TAGS.find(t => props.presetTags.includes(t)) ?? ''
    images.value = []
    preview.value = false
    selectedCircle.value = props.circleId ?? ''
  } else {
    // 关闭时释放本地预览地址
    for (const i of images.value) URL.revokeObjectURL(i.localUrl)
  }
})

// ---------- Markdown 工具栏 ----------

/** 在光标处包裹/插入 Markdown 语法（选中文本作为内容，否则插入占位符） */
function insertMd(before: string, after: string, placeholder = '') {
  const el = textareaRef.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = content.value.slice(start, end) || placeholder
  content.value = content.value.slice(0, start) + before + selected + after + content.value.slice(end)
  // 恢复光标到内容末尾
  const pos = start + before.length + selected.length
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

const mdActions = [
  { icon: 'B', title: '粗体', run: () => insertMd('**', '**', '粗体') },
  { icon: '< >', title: '行内代码', run: () => insertMd('`', '`', 'code') },
  { icon: '{ }', title: '代码块', run: () => insertMd('\n```\n', '\n```\n', '代码') },
  { icon: '>', title: '引用', run: () => insertMd('\n> ', '\n', '引用内容') },
  { icon: '•', title: '无序列表', run: () => insertMd('\n- ', '', '列表项') },
  { icon: 'Σ', title: '行内公式', run: () => insertMd('$', '$', 'E=mc^2') },
  { icon: 'ΣΣ', title: '块级公式', run: () => insertMd('\n$$\n', '\n$$\n', 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}') }
]

/** 经验帖结构化模板文案（科目/方法/心得/建议四段） */
const EXPERIENCE_TEMPLATE = [
  '科目：',
  '学习方法：',
  '心得体会：',
  '给后来人的建议：'
].join('\n')

function applyExperienceTemplate() {
  if (content.value.trim() && !window.confirm('替换当前内容为经验帖模板？')) return
  content.value = EXPERIENCE_TEMPLATE
  if (!tags.value.includes('#升本经验') && tags.value.length < 5) tags.value.push('#升本经验')
}

function switchType(t: PostType) {
  postType.value = t
  // 切到提问模式时，把通用标签里的科目标签收编到单选框
  if (t === 'question') {
    const found = tags.value.find(x => QUESTION_SUBJECT_TAGS.includes(x))
    if (found) {
      subject.value = found
      tags.value = tags.value.filter(x => !QUESTION_SUBJECT_TAGS.includes(x))
    }
  } else if (subject.value) {
    if (!tags.value.includes(subject.value) && tags.value.length < 5) tags.value.push(subject.value)
    subject.value = ''
  }
}

function toggleTag(t: string) {
  const i = tags.value.indexOf(t)
  if (i >= 0) { tags.value.splice(i, 1); return }
  // 提问帖的科目标签占一个名额（服务端共限 5 个），故通用标签最多 4 个
  const max = isQuestion.value && subject.value ? 4 : 5
  if (tags.value.length < max) tags.value.push(t)
  else toast('最多选择 5 个标签')
}

// ---------- 图片上传 ----------

function addFiles(files: Iterable<File>) {
  for (const file of files) {
    if (images.value.length >= IMAGE_MAX_PER_POST) { toast(`最多上传 ${IMAGE_MAX_PER_POST} 张图片`); break }
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast('仅支持 PNG / JPEG / WebP / GIF 图片'); continue }
    if (file.size > IMAGE_MAX_BYTES) { toast(`图片「${file.name}」超过 5MB 上限`); continue }
    const item: PendingImage = { localUrl: URL.createObjectURL(file), file, progress: 0 }
    images.value.push(item)
    // 通过响应式代理引用更新：数组内保存的是 reactive(item)，直接改原始 item 不会触发重渲染
    const img = images.value[images.value.length - 1]
    uploadImage(file, r => { img.progress = r })
      .then(res => { if (res?.url) img.url = res.url; else img.error = '上传返回异常，请重试' })
      .catch((e: any) => { img.error = e?.message || '上传失败' })
  }
}

function pickImages() { fileInput.value?.click() }

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files)
  input.value = '' // 允许重复选择同一文件
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (files?.length) addFiles(files)
}

function onPaste(e: ClipboardEvent) {
  const files = e.clipboardData?.files
  if (files?.length) {
    e.preventDefault()
    addFiles(files)
  }
}

function removeImage(idx: number) {
  const [item] = images.value.splice(idx, 1)
  if (item) URL.revokeObjectURL(item.localUrl)
}

function retryImage(idx: number) {
  const img = images.value[idx]
  if (!img?.file) return
  img.error = undefined
  img.progress = 0
  uploadImage(img.file, r => { img.progress = r })
    .then(res => { if (res?.url) img.url = res.url; else img.error = '上传返回异常，请重试' })
    .catch((e: any) => { img.error = e?.message || '上传失败' })
}

// ---------- 提交 ----------

async function submit() {
  const text = content.value.trim()
  // 图文至少一项（支持纯图片发帖）
  if (!text && !images.value.length) { toast('请输入内容或添加图片'); return }
  if (isQuestion.value && !subject.value) { toast('提问帖请选择科目标签'); return }
  if (images.value.some(i => i.error)) { toast('存在上传失败的图片，请移除或重试'); return }
  if (uploading.value) { toast('图片上传中，请稍候'); return }
  const finalTags = isQuestion.value ? [subject.value, ...tags.value] : tags.value
  submitting.value = true
  try {
    await store.publishPost({
      type: postType.value, content: text, tags: finalTags,
      imageUrls: images.value.map(i => i.url!),
      circleId: props.topicRef ? undefined : (selectedCircle.value || undefined),
      topicRef: props.topicRef,
      refType: props.refType, refId: props.refId
    })
    toast(props.topicRef ? '已发布到讨论区' : '已发布到社区广场')
    emit('update:show', false)
    emit('posted')
  } catch (e: any) {
    toast(e?.message || '发布失败，请稍后再试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :show="show" :title="isQuestion ? '提问' : '分享到广场'" @close="emit('update:show', false)">
    <!-- 类型切换（仅广场主入口） -->
    <div v-if="allowTypeSwitch" class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs mb-3 w-fit">
      <button class="px-3 py-1.5 rounded-md transition-colors"
        :class="!isQuestion ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
        @click="switchType('share')">分享</button>
      <button class="px-3 py-1.5 rounded-md transition-colors"
        :class="isQuestion ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
        @click="switchType('question')">提问</button>
    </div>

    <!-- Markdown 工具栏 + 预览切换 -->
    <div class="flex items-center gap-1 mb-1.5 flex-wrap">
      <button v-for="a in mdActions" :key="a.title" type="button"
        class="px-1.5 py-1 rounded text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary-500 transition-colors"
        :title="a.title" :disabled="preview" @click="a.run">{{ a.icon }}</button>
      <button v-if="allowTemplate && !isQuestion" type="button"
        class="px-1.5 py-1 rounded text-[11px] font-medium text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 transition-colors"
        title="填入经验帖结构化模板" @click="applyExperienceTemplate">经验帖</button>
      <div class="flex-1"></div>
      <div class="flex bg-slate-100 dark:bg-slate-700 rounded-md p-0.5 text-[10px]">
        <button class="px-2 py-1 rounded transition-colors"
          :class="!preview ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="preview = false">编辑</button>
        <button class="px-2 py-1 rounded transition-colors"
          :class="preview ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="preview = true">预览</button>
      </div>
    </div>

    <div @dragover.prevent @drop.prevent="onDrop">
      <textarea v-show="!preview" ref="textareaRef" v-model="content" rows="6" maxlength="5000" class="input"
        :placeholder="placeholder" @paste="onPaste"></textarea>
      <div v-if="preview" class="input min-h-[9rem] overflow-y-auto md-body text-sm"
        v-html="previewHtml || '<span style=&quot;color:#94a3b8&quot;>暂无内容</span>'"></div>
    </div>
    <div class="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
      <span>支持 Markdown：粗体 / 代码 / 引用 / 列表 / $公式$ / $$块级公式$$</span>
      <span>{{ content.length }}/5000</span>
    </div>

    <!-- 图片区 -->
    <div class="mt-2">
      <div class="flex items-center gap-2">
        <button class="btn-ghost !text-xs" @click="pickImages">添加图片</button>
        <span class="text-[10px] text-slate-400">点击 / 拖拽 / Ctrl+V 粘贴，最多 {{ IMAGE_MAX_PER_POST }} 张，单张 ≤5MB</span>
      </div>
      <input ref="fileInput" type="file" :accept="IMAGE_ACCEPT" multiple class="hidden" @change="onFileChange" />
      <div v-if="images.length" class="grid grid-cols-3 gap-2 mt-2">
        <div v-for="(img, i) in images" :key="img.localUrl" class="relative aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
          <img :src="img.localUrl" class="w-full h-full object-cover" :class="{ 'opacity-50': !img.url && !img.error }" />
          <!-- 上传进度 -->
          <div v-if="!img.url && !img.error" class="absolute inset-x-1 bottom-1 h-1 rounded bg-white/50">
            <div class="h-full rounded bg-primary-500 transition-all" :style="{ width: `${Math.round(img.progress * 100)}%` }"></div>
          </div>
          <!-- 失败态 -->
          <div v-if="img.error" class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-xs bg-white/70 dark:bg-slate-900/70">
            <button class="text-red-500 font-medium" @click="retryImage(i)">重试</button>
            <button class="text-slate-500" @click="removeImage(i)">移除</button>
          </div>
          <!-- 删除 -->
          <button class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white text-xs leading-none"
            @click="removeImage(i)">×</button>
        </div>
      </div>
    </div>

    <!-- 提问帖科目标签（必选，单选） -->
    <template v-if="isQuestion">
      <div class="label mt-2">科目标签（必选）</div>
      <div class="flex flex-wrap gap-1.5">
        <TagBadge v-for="t in QUESTION_SUBJECT_TAGS" :key="t" :tag="t" :active="subject === t"
          @click="subject = subject === t ? '' : t" />
      </div>
    </template>

    <div class="label mt-2">话题标签（最多 5 个）</div>
    <div class="flex flex-wrap gap-1.5">
      <TagBadge v-for="t in COMMUNITY_TAGS.filter(t => !isQuestion || !QUESTION_SUBJECT_TAGS.includes(t))" :key="t"
        :tag="t" :active="tags.includes(t)" @click="toggleTag(t)" />
    </div>

    <!-- 圈子选择器（仅广场入口且已加入圈子、非讨论区发帖时展示；圈子帖不进公共广场） -->
    <template v-if="circleId === undefined && topicRef === undefined && myCircles.length">
      <div class="label mt-2">发布到（圈子帖仅圈内可见）</div>
      <div class="flex flex-wrap gap-1.5">
        <button class="px-2.5 py-1 rounded-full text-xs transition-colors"
          :class="!selectedCircle ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'"
          @click="selectedCircle = ''">广场</button>
        <button v-for="c in myCircles" :key="c.id" class="px-2.5 py-1 rounded-full text-xs transition-colors"
          :class="selectedCircle === c.id ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'"
          @click="selectedCircle = c.id">{{ c.name }}</button>
      </div>
    </template>

    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" :disabled="submitting || uploading" @click="submit">
        {{ submitting ? '发布中…' : uploading ? '图片上传中…' : '发布' }}
      </button>
    </template>
  </Modal>
</template>
