<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import { computed, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { feedbackApi } from '../api/feedback'
import { uploadImage, imageUrl } from '../api/community'
import { useBack } from '../composables/useBack'
import type { FeedbackType } from '../types'

const { goBack } = useBack()
const toast = useToast()

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'feature', label: '功能建议' },
  { value: 'bug', label: '问题反馈' },
  { value: 'experience', label: '体验评价' },
  { value: 'other', label: '其他' }
]

const type = ref<FeedbackType>('feature')
const content = ref('')
const contact = ref('')
const images = ref<{ url: string }[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
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
  if (uploading.value || submitting.value) return
  const slots = IMAGE_MAX - images.value.length
  if (slots <= 0) return
  uploading.value = true
  try {
    for (const file of files.slice(0, slots)) {
      try {
        const res = await uploadImage(file)
        images.value.push({ url: res.url })
      } catch (err) {
        toast(getErrorMessage(err, '图片上传失败'))
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
  if (submitting.value || uploading.value) return
  if (!content.value.trim()) {
    toast('请填写反馈内容')
    return
  }
  submitting.value = true
  try {
    await feedbackApi.create({
      type: type.value,
      content: content.value.trim(),
      contact: contact.value.trim() || undefined,
      imageUrls: images.value.map((i) => i.url)
    })
    toast('已提交反馈')
    goBack()
  } catch (e) {
    toast(getErrorMessage(e, '反馈未能提交，请检查网络后重试'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="study-page reading-page space-y-4">
    <div class="flex items-center gap-2">
      <span class="arrow-action" @click="goBack"
        ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
      >
      <h1 class="page-title">意见反馈</h1>
    </div>

    <div class="card space-y-4">
      <!-- 问题类型 -->
      <div>
        <div class="label">问题类型</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="o in TYPE_OPTIONS"
            :key="o.value"
            class="min-h-11 px-3 py-1.5 rounded-full text-sm border transition-colors"
            :class="
              type === o.value
                ? 'bg-primary-50 dark:bg-primary-900/30 text-action dark:text-action border-primary-200 dark:border-primary-800 font-semibold'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            "
            :aria-pressed="type === o.value"
            @click="type = o.value"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <!-- 文字描述 -->
      <div>
        <div class="label">描述 <span class="text-correction">*</span></div>
        <textarea
          v-model="content"
          :maxlength="CONTENT_MAX"
          rows="5"
          class="input !h-auto resize-y"
          aria-label="请描述你遇到的问题或建议…"
          placeholder="请描述你遇到的问题或建议…"
        />
        <div class="text-right text-xs text-slate-400 mt-1">{{ content.length }} / {{ CONTENT_MAX }}</div>
      </div>

      <!-- 截图上传 -->
      <div>
        <div class="label">截图（可选，最多 {{ IMAGE_MAX }} 张）</div>
        <div class="flex flex-wrap gap-2">
          <div v-for="(img, i) in images" :key="img.url" class="relative w-20 h-20">
            <img
              :src="imageUrl(img.url)"
              class="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
              alt="反馈截图"
            />
            <button
              type="button"
              class="absolute -top-2 -right-2 w-11 h-11 flex items-center justify-center rounded-control"
              :aria-label="`移除第${i + 1}张截图`"
              @click="removeImage(i)"
            >
              <span
                class="w-5 h-5 flex items-center justify-center rounded-full bg-ink text-surface text-xs leading-none"
                aria-hidden="true"
                >×</span
              >
            </button>
          </div>
          <button
            v-if="images.length < IMAGE_MAX"
            type="button"
            :disabled="uploading"
            aria-label="添加反馈截图"
            class="w-20 h-20 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center text-slate-400 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
            @click="fileInput?.click()"
          >
            <span class="text-xl leading-none">{{ uploading ? '…' : '+' }}</span>
            <span>{{ uploading ? '上传中' : '添加截图' }}</span>
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            :disabled="uploading"
            @change="onPick"
          />
        </div>
      </div>

      <!-- 联系方式 -->
      <div>
        <div class="label">联系方式（可选）</div>
        <input
          v-model="contact"
          :maxlength="100"
          class="input"
          aria-label="QQ / 微信 / 邮箱，便于我们跟进"
          placeholder="QQ / 微信 / 邮箱，便于我们跟进"
        />
      </div>

      <button class="btn-primary w-full" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '提交中…' : '提交反馈' }}
      </button>
    </div>
  </div>
</template>
