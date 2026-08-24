<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { uploadImage, IMAGE_MAX_BYTES, IMAGE_MAX_PER_COMMENT } from '../../api/community'
import { isLoggedIn } from '../../services/auth'

/**
 * 评论输入框：支持配图（最多 3 张）：点击按钮选择 / Ctrl+V 粘贴；上传中禁止发送。
 * 通过 defineExpose 暴露 focus()，供父组件在点击回复时聚焦输入框。
 */
const props = withDefaults(defineProps<{ placeholder?: string; submitting?: boolean }>(), {
  placeholder: '写下你的评论…（支持 emoji）',
  submitting: false
})
const emit = defineEmits<{ send: [text: string, imageUrls: string[]] }>()

const toast = inject<(m: string) => void>('toast', () => {})

interface PendingImage {
  localUrl: string
  file?: File
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

/** 供父组件（如点击评论回复）主动聚焦输入框；发送成功后由父组件调用 reset() 清空输入 */
defineExpose({
  focus: () => inputRef.value?.focus(),
  reset: () => {
    text.value = ''
    for (const i of images.value) URL.revokeObjectURL(i.localUrl)
    images.value = []
  }
})

function addFiles(files: Iterable<File>) {
  for (const file of files) {
    if (images.value.length >= IMAGE_MAX_PER_COMMENT) { toast(`评论最多上传 ${IMAGE_MAX_PER_COMMENT} 张图片`); break }
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

function retryImage(idx: number) {
  const img = images.value[idx]
  if (!img?.file) return
  img.error = undefined
  img.progress = 0
  uploadImage(img.file, r => { img.progress = r })
    .then(res => { if (res?.url) img.url = res.url; else img.error = '上传返回异常，请重试' })
    .catch((e: any) => { img.error = e?.message || '上传失败' })
}

function send() {
  const t = text.value.trim()
  // 图文至少一项（支持纯图片评论）；上传中或提交中禁止发送
  if ((!t && !images.value.length) || uploading.value || props.submitting) return
  if (images.value.some(i => i.error)) { toast('存在上传失败的图片，请重试或移除后发送'); return }
  // 提交中不清空输入，成功后由父组件调用 reset() 清空；失败则保留用户输入
  emit('send', t, images.value.map(i => i.url!))
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-2 items-end">
      <textarea ref="inputRef" v-model="text" rows="1" maxlength="1000" class="input flex-1"
        :disabled="!isLoggedIn || submitting" :placeholder="isLoggedIn ? placeholder : '登录后参与评论…'"
        @keydown.enter.exact.prevent="send" @paste="onPaste"></textarea>
      <button v-if="isLoggedIn" class="btn-ghost !px-2.5 shrink-0" title="添加图片（最多 3 张）" :disabled="submitting" @click="fileInput?.click()">🖼️</button>
      <button v-if="isLoggedIn" class="btn-primary shrink-0" :disabled="(!text.trim() && !images.length) || uploading || submitting" @click="send">
        {{ submitting ? '发送中…' : uploading ? '上传中…' : '发送' }}
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
        <div v-if="img.error" class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[10px] bg-white/70 dark:bg-slate-900/70">
          <button class="text-red-500 font-medium" @click="retryImage(i)">重试</button>
          <button class="text-slate-500" @click="removeImage(i)">移除</button>
        </div>
        <button v-else class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 text-white text-[10px] leading-none"
          @click="removeImage(i)">×</button>
      </div>
    </div>
  </div>
</template>
