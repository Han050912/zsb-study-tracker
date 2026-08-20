<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { uploadImage, IMAGE_MAX_BYTES, IMAGE_MAX_PER_COMMENT } from '../../api/community'

/**
 * 评论输入框：presetText 变化时填充（用于「回复 @某人」前缀）。
 * 支持配图（最多 3 张）：点击按钮选择 / Ctrl+V 粘贴；上传中禁止发送。
 */
const props = withDefaults(defineProps<{ placeholder?: string; presetText?: string }>(), {
  placeholder: '写下你的评论…（支持 emoji）',
  presetText: ''
})
const emit = defineEmits<{ send: [text: string, imageUrls: string[]] }>()

const toast = inject<(m: string) => void>('toast', () => {})

interface PendingImage {
  localUrl: string
  url?: string
  progress: number
  error?: string
}

const text = ref('')
const images = ref<PendingImage[]>([])
const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** 存在未完成的图片上传时禁止发送 */
const uploading = computed(() => images.value.some(i => !i.url && !i.error))

watch(() => props.presetText, v => {
  if (v) {
    text.value = v
    inputRef.value?.focus()
  }
})

function addFiles(files: Iterable<File>) {
  for (const file of files) {
    if (images.value.length >= IMAGE_MAX_PER_COMMENT) { toast(`评论最多上传 ${IMAGE_MAX_PER_COMMENT} 张图片`); break }
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast('仅支持 PNG / JPEG / WebP / GIF 图片'); continue }
    if (file.size > IMAGE_MAX_BYTES) { toast(`图片「${file.name}」超过 5MB 上限`); continue }
    const item: PendingImage = { localUrl: URL.createObjectURL(file), progress: 0 }
    images.value.push(item)
    // 通过响应式代理引用更新：数组内保存的是 reactive(item)，直接改原始 item 不会触发重渲染
    const img = images.value[images.value.length - 1]
    uploadImage(file, r => { img.progress = r })
      .then(res => { if (res?.url) img.url = res.url; else img.error = '上传返回异常，请重试' })
      .catch((e: any) => { img.error = e?.message || '上传失败' })
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files)
  input.value = ''
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

function send() {
  const t = text.value.trim()
  if (!t || uploading.value) return
  if (images.value.some(i => i.error)) { toast('存在上传失败的图片，请移除后重试'); return }
  emit('send', t, images.value.map(i => i.url!))
  text.value = ''
  for (const i of images.value) URL.revokeObjectURL(i.localUrl)
  images.value = []
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-2 items-end">
      <textarea ref="inputRef" v-model="text" rows="1" maxlength="1000" class="input flex-1"
        :placeholder="placeholder" @keydown.enter.exact.prevent="send" @paste="onPaste"></textarea>
      <button class="btn-ghost !px-2.5 shrink-0" title="添加图片（最多 3 张）" @click="fileInput?.click()">🖼️</button>
      <button class="btn-primary shrink-0" :disabled="!text.trim() || uploading" @click="send">
        {{ uploading ? '上传中…' : '发送' }}
      </button>
    </div>
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="hidden" @change="onFileChange" />
    <div v-if="images.length" class="flex gap-2">
      <div v-for="(img, i) in images" :key="img.localUrl"
        class="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
        <img :src="img.localUrl" class="w-full h-full object-cover" :class="{ 'opacity-50': !img.url && !img.error }" />
        <div v-if="!img.url && !img.error" class="absolute inset-x-1 bottom-1 h-1 rounded bg-white/50">
          <div class="h-full rounded bg-primary-500 transition-all" :style="{ width: `${Math.round(img.progress * 100)}%` }"></div>
        </div>
        <button v-if="img.error" class="absolute inset-0 flex items-center justify-center text-[10px] text-red-500 bg-white/70 dark:bg-slate-900/70"
          @click="removeImage(i)">失败，点击移除</button>
        <button v-else class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 text-white text-[10px] leading-none"
          @click="removeImage(i)">×</button>
      </div>
    </div>
  </div>
</template>
