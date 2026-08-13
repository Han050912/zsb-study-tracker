<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import TagBadge from './TagBadge.vue'
import { useCommunityStore } from '../../stores/community'
import { COMMUNITY_TAGS } from '../../data/defaults'
import { uploadImage, IMAGE_MAX_BYTES, IMAGE_MAX_PER_POST } from '../../api/community'
import type { PostType } from '../../types'

/**
 * 发帖/分享编辑器：普通发帖、提问帖与各页面「分享到广场」共用。
 * 打开时（show 变为 true）以 preset 内容重置表单。
 * 图片支持点击选择 / 拖拽 / Ctrl+V 粘贴三种方式，上传中展示进度条（XHR upload progress）。
 */
const props = withDefaults(defineProps<{
  show: boolean
  type: PostType
  presetContent?: string
  presetTags?: string[]
  refType?: string
  refId?: string
  /** 允许在「分享 / 提问」之间切换（仅广场主发帖入口开启） */
  allowTypeSwitch?: boolean
}>(), { presetContent: '', presetTags: () => [], refType: undefined, refId: undefined, allowTypeSwitch: false })

const emit = defineEmits<{ 'update:show': [boolean]; posted: [] }>()

const store = useCommunityStore()
const toast = inject<(m: string) => void>('toast', () => {})

/** 提问帖必选的科目标签（与服务端 QUESTION_SUBJECT_TAGS 一致） */
const QUESTION_SUBJECT_TAGS = ['#高等数学', '#英语']
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

interface PendingImage {
  /** 本地预览地址（blob:） */
  localUrl: string
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
  } else {
    // 关闭时释放本地预览地址
    for (const i of images.value) URL.revokeObjectURL(i.localUrl)
  }
})

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
    const item: PendingImage = { localUrl: URL.createObjectURL(file), progress: 0 }
    images.value.push(item)
    uploadImage(file, r => { item.progress = r })
      .then(res => { item.url = res.url })
      .catch((e: any) => { item.error = e?.message || '上传失败' })
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
  // 重试需要原始 File，简单起见提示用户重新添加
  removeImage(idx)
  toast('请重新添加该图片')
}

// ---------- 提交 ----------

async function submit() {
  const text = content.value.trim()
  if (!text) { toast('请填写内容'); return }
  if (isQuestion.value && !subject.value) { toast('提问帖请选择科目标签'); return }
  if (images.value.some(i => i.error)) { toast('存在上传失败的图片，请移除或重试'); return }
  if (uploading.value) { toast('图片上传中，请稍候'); return }
  const finalTags = isQuestion.value ? [subject.value, ...tags.value] : tags.value
  submitting.value = true
  try {
    await store.publishPost({
      type: postType.value, content: text, tags: finalTags,
      imageUrls: images.value.map(i => i.url!),
      refType: props.refType, refId: props.refId
    })
    toast('已发布到社区广场')
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
        @click="switchType('share')">📝 分享</button>
      <button class="px-3 py-1.5 rounded-md transition-colors"
        :class="isQuestion ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
        @click="switchType('question')">❓ 提问</button>
    </div>

    <div @dragover.prevent @drop.prevent="onDrop">
      <textarea v-model="content" rows="6" maxlength="5000" class="input"
        :placeholder="placeholder" @paste="onPaste"></textarea>
    </div>
    <div class="text-right text-[10px] text-slate-400 mt-0.5">{{ content.length }}/5000</div>

    <!-- 图片区 -->
    <div class="mt-2">
      <div class="flex items-center gap-2">
        <button class="btn-ghost !text-xs" @click="pickImages">🖼️ 添加图片</button>
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
          <button v-if="img.error" class="absolute inset-0 flex items-center justify-center text-xs text-red-500 bg-white/70 dark:bg-slate-900/70"
            @click="retryImage(i)">上传失败，点击移除</button>
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

    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" :disabled="submitting || uploading" @click="submit">
        {{ submitting ? '发布中…' : uploading ? '图片上传中…' : '发布' }}
      </button>
    </template>
  </Modal>
</template>
