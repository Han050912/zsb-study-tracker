<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRouter } from 'vue-router'
import { feedbackApi } from '../api/feedback'
import { uploadImage, imageUrl } from '../api/community'
import type { FeedbackType } from '../types'

const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'feature', label: '功能建议' },
  { value: 'bug', label: 'Bug报告' },
  { value: 'experience', label: '体验评价' },
  { value: 'other', label: '其他' }
]

const type = ref<FeedbackType>('feature')
const content = ref('')
const contact = ref('')
const images = ref<{ url: string }[]>([])
const uploading = ref(false)
const submitting = ref(false)

const CONTENT_MAX = 2000
const IMAGE_MAX = 3
const canSubmit = computed(() => !!content.value.trim() && !uploading.value && !submitting.value)

/** 选图 → 逐张压缩上传，拿到公开 url 后加入 images */
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  const slots = IMAGE_MAX - images.value.length
  if (slots <= 0) return
  uploading.value = true
  try {
    for (const file of files.slice(0, slots)) {
      try {
        const res = await uploadImage(file)
        images.value.push({ url: res.url })
      } catch (err: any) {
        toast(err?.message || '图片上传失败')
      }
    }
  } finally {
    uploading.value = false
  }
}

function removeImage(i: number) {
  images.value.splice(i, 1)
}

async function submit() {
  if (!content.value.trim()) { toast('请填写反馈内容'); return }
  submitting.value = true
  try {
    await feedbackApi.create({
      type: type.value,
      content: content.value.trim(),
      contact: contact.value.trim() || undefined,
      imageUrls: images.value.map(i => i.url)
    })
    toast('反馈已提交，感谢！')
    router.back()
  } catch (e: any) {
    toast(e?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2.5" @click="router.back()">←</button>
      <h1 class="page-title">💡 意见反馈</h1>
    </div>

    <div class="card space-y-4">
      <!-- 问题类型 -->
      <div>
        <div class="label">问题类型</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="o in TYPE_OPTIONS" :key="o.value"
            class="px-3 py-1.5 rounded-full text-sm border transition-colors"
            :class="type === o.value
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-800 font-semibold'
              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'"
            @click="type = o.value">{{ o.label }}</button>
        </div>
      </div>

      <!-- 文字描述 -->
      <div>
        <div class="label">描述 <span class="text-red-400">*</span></div>
        <textarea v-model="content" :maxlength="CONTENT_MAX" rows="5" class="input !h-auto resize-y"
          placeholder="请描述你遇到的问题或建议…" />
        <div class="text-right text-[10px] text-slate-400 mt-1">{{ content.length }} / {{ CONTENT_MAX }}</div>
      </div>

      <!-- 截图上传 -->
      <div>
        <div class="label">截图（可选，最多 {{ IMAGE_MAX }} 张）</div>
        <div class="flex flex-wrap gap-2">
          <div v-for="(img, i) in images" :key="img.url" class="relative w-20 h-20">
            <img :src="imageUrl(img.url)" class="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
            <button class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 text-white text-xs leading-none"
              @click="removeImage(i)">×</button>
          </div>
          <label v-if="images.length < IMAGE_MAX"
            class="w-20 h-20 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center text-slate-400 text-[10px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
            <span class="text-xl leading-none">{{ uploading ? '…' : '+' }}</span>
            <span>{{ uploading ? '上传中' : '添加截图' }}</span>
            <input type="file" accept="image/*" multiple class="hidden" @change="onPick" />
          </label>
        </div>
      </div>

      <!-- 联系方式 -->
      <div>
        <div class="label">联系方式（可选）</div>
        <input v-model="contact" :maxlength="100" class="input" placeholder="QQ / 微信 / 邮箱，便于我们跟进" />
      </div>

      <button class="btn-primary w-full" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '提交中…' : '提交反馈' }}
      </button>
    </div>
  </div>
</template>
