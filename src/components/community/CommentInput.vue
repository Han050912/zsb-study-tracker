<script setup lang="ts">
import { ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useImageUpload } from '../../composables/useImageUpload'
import { IMAGE_MAX_PER_COMMENT } from '../../api/community'
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

const toast = useToast()

const {
  images,
  uploading,
  hasError,
  fileInput,
  pickImages,
  onFileChange,
  onPaste,
  removeImage,
  retryImage,
  reset: resetImages
} = useImageUpload(IMAGE_MAX_PER_COMMENT)

const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

/** 供父组件（如点击评论回复）主动聚焦输入框；发送成功后由父组件调用 reset() 清空输入 */
defineExpose({
  focus: () => inputRef.value?.focus(),
  reset: () => {
    text.value = ''
    resetImages()
  }
})

function send() {
  const t = text.value.trim()
  // 图文至少一项（支持纯图片评论）；上传中或提交中禁止发送
  if ((!t && !images.value.length) || uploading.value || props.submitting) return
  if (hasError.value) {
    toast('存在上传失败的图片，请重试或移除后发送')
    return
  }
  // 提交中不清空输入，成功后由父组件调用 reset() 清空；失败则保留用户输入
  emit(
    'send',
    t,
    images.value.map((i) => i.url!)
  )
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-2 items-end">
      <textarea
        ref="inputRef"
        v-model="text"
        rows="1"
        maxlength="1000"
        class="input flex-1"
        :disabled="!isLoggedIn || submitting"
        :placeholder="isLoggedIn ? placeholder : '登录后参与评论…'"
        @keydown.enter.exact.prevent="send"
        @paste="onPaste"
      ></textarea>
      <button
        v-if="isLoggedIn"
        class="btn-ghost !px-2.5 shrink-0"
        title="添加图片（最多 3 张）"
        :disabled="submitting"
        @click="pickImages"
      >
        🖼️
      </button>
      <button
        v-if="isLoggedIn"
        class="btn-primary shrink-0"
        :disabled="(!text.trim() && !images.length) || uploading || submitting"
        @click="send"
      >
        {{ submitting ? '发送中…' : uploading ? '上传中…' : '发送' }}
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      class="hidden"
      @change="onFileChange"
    />
    <div v-if="images.length" class="flex gap-2">
      <div
        v-for="(img, i) in images"
        :key="img.localUrl"
        class="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700"
      >
        <img :src="img.localUrl" class="w-full h-full object-cover" :class="{ 'opacity-50': !img.url && !img.error }" />
        <div v-if="!img.url && !img.error" class="absolute inset-x-1 bottom-1 h-1 rounded bg-white/50">
          <div
            class="h-full rounded bg-primary-500 transition-all"
            :style="{ width: `${Math.round(img.progress * 100)}%` }"
          ></div>
        </div>
        <div
          v-if="img.error"
          class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[10px] bg-white/70 dark:bg-slate-900/70"
        >
          <button class="text-red-500 font-medium" @click="retryImage(i)">重试</button>
          <button class="text-slate-500" @click="removeImage(i)">移除</button>
        </div>
        <button
          class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 text-white text-[10px] leading-none"
          @click="removeImage(i)"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>
