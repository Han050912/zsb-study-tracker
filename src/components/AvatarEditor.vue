<script setup lang="ts">
/**
 * 头像编辑弹窗：选择图片 → cropperjs 1:1 交互裁剪 → 256×256 WebP（回退 PNG）上传。
 * 上传成功 emit('uploaded', url)，由调用方更新本地状态（store.settings.avatar）。
 */
import { inject, nextTick, onUnmounted, ref, watch } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import Modal from './Modal.vue'
import { IMAGE_MAX_BYTES, uploadAvatar } from '../api/community'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean]; uploaded: [string] }>()

const toast = inject<(m: string) => void>('toast', () => {})

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const fileInput = ref<HTMLInputElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
const imgUrl = ref('')
const uploading = ref(false)
let cropper: Cropper | null = null
let objectUrl = ''

function destroyCropper() {
  cropper?.destroy()
  cropper = null
}

function reset() {
  destroyCropper()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  imgUrl.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (!ALLOWED_TYPES.includes(f.type)) {
    toast('仅支持 JPG / PNG / WebP 图片')
    return
  }
  if (f.size > IMAGE_MAX_BYTES) {
    toast('图片不能超过 5MB')
    return
  }
  objectUrl = URL.createObjectURL(f)
  imgUrl.value = objectUrl
  nextTick(() => {
    if (!imgRef.value) return
    destroyCropper()
    cropper = new Cropper(imgRef.value, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      responsive: false
    })
  })
}

async function submit() {
  if (!cropper || uploading.value) return
  uploading.value = true
  try {
    const canvas = cropper.getCroppedCanvas({ width: 256, height: 256, imageSmoothingQuality: 'high' })
    if (!canvas) throw new Error('图片裁剪失败，请重试')
    let blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.9))
    if (!blob) blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('图片导出失败，请重试')
    const { url } = await uploadAvatar(blob)
    emit('uploaded', url)
    emit('update:show', false)
    reset()
    toast('头像已更新')
  } catch (e: any) {
    toast(e?.message || '上传失败，请重试')
  } finally {
    uploading.value = false
  }
}

watch(() => props.show, v => { if (!v) reset() })
onUnmounted(reset)
</script>

<template>
  <Modal :show="show" title="更换头像" @close="emit('update:show', false)">
    <div v-if="!imgUrl" class="py-10 text-center space-y-3">
      <div>
        <button class="btn-primary" type="button" @click="fileInput?.click()">选择图片</button>
      </div>
      <p class="text-xs text-slate-400">支持 JPG / PNG / WebP，不超过 5MB，将裁剪为正方形</p>
    </div>
    <div v-else>
      <div class="w-full max-h-[50vh] overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-700">
        <img ref="imgRef" :src="imgUrl" class="block max-w-full" alt="头像裁剪预览">
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <button class="btn-ghost" type="button" :disabled="uploading" @click="reset">重选图片</button>
        <button class="btn-primary" type="button" :disabled="uploading" @click="submit">
          {{ uploading ? '上传中…' : '确认上传' }}
        </button>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onFile">
  </Modal>
</template>
