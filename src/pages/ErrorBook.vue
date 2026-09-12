<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useToast } from '../composables/useToast'
import { useAppStore } from '../stores/app'
import { today } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { problemTypesFor } from '../data/problemTypes'
import Modal from '../components/Modal.vue'
import PartnerShareModal from '../components/partner/PartnerShareModal.vue'
import RemoteImage from '../components/RemoteImage.vue'
import { ERROR_IMAGE_PREFIX, uploadErrorImage } from '../api/errorImages'

const store = useAppStore()
const toast = useToast()

// ---- 分享给搭子（目标错题 id，空 = 关闭弹窗） ----
const shareTarget = ref('')

const filterSubject = ref('')
const showOnlyUnmastered = ref(false)

const list = computed(() => {
  let l = store.errorQuestions.slice().reverse()
  if (filterSubject.value) l = l.filter((e) => e.subjectId === filterSubject.value)
  if (showOnlyUnmastered.value) l = l.filter((e) => !e.mastered)
  return l
})

const showModal = ref(false)
const form = ref({ subjectId: 'math', chapter: '', type: '选择', content: '', answer: '', image: '' })

// ---- 题型 / 章节：跟随科目动态联动 ----
const currentTypes = computed(() => problemTypesFor(form.value.subjectId))
const currentSubject = computed(() => store.subjects.find((s) => s.id === form.value.subjectId))
const chapterPick = ref({ chapterName: '', topicName: '' })
const currentChapterTopics = computed(() => {
  const ch = currentSubject.value?.chapters.find((c) => c.name === chapterPick.value.chapterName)
  return ch?.topics ?? []
})

function onChapterNamePick() {
  chapterPick.value.topicName = ''
  form.value.chapter = chapterPick.value.chapterName
}
function onTopicPick() {
  form.value.chapter = chapterPick.value.topicName
}

// 科目切换：题型置为当前科目首个题型，清空章节与两栏选中残留
watch(
  () => form.value.subjectId,
  (newId) => {
    const types = problemTypesFor(newId)
    form.value.type = types[0]?.label ?? ''
    form.value.chapter = ''
    chapterPick.value = { chapterName: '', topicName: '' }
  }
)

// 图片在客户端压缩到最长边 1600px / JPEG 质量 0.85（通常 200~400KB），
// 保存时才上传到对象存储，state 中仅保留 'r2:<sha256>' 引用。
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 原始文件上限 10MB（压缩前）
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85

/** 待上传的压缩后图片（保存成功前只存在于内存，避免落半成品记录） */
const pendingImage = ref<{ bytes: ArrayBuffer; preview: string } | null>(null)
/** 保存中：上传 + 落库期间禁用保存按钮 */
const saving = ref(false)

function clearPendingImage() {
  if (pendingImage.value) URL.revokeObjectURL(pendingImage.value.preview)
  pendingImage.value = null
}

function onImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > MAX_UPLOAD_BYTES) {
    toast('图片过大，请选择 10MB 以内的照片')
    input.value = ''
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        toast('图片处理失败，请重试')
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            toast('图片处理失败，请重试')
            return
          }
          if (!showModal.value) return // 弹窗已关闭：丢弃迟到的压缩结果，避免幽灵预览
          clearPendingImage()
          pendingImage.value = { bytes: await blob.arrayBuffer(), preview: URL.createObjectURL(blob) }
        },
        'image/jpeg',
        JPEG_QUALITY
      )
    }
    img.onerror = () => toast('图片读取失败，请重试')
    img.src = reader.result as string
  }
  reader.readAsDataURL(file)
  // 清空 input 使同一文件可再次触发 change
  input.value = ''
}

/** 关闭弹窗并清空表单与待上传图片；上传进行中不允许关闭（避免落半成品记录） */
function closeModal() {
  if (saving.value) return
  showModal.value = false
  form.value = { subjectId: 'math', chapter: '', type: '选择', content: '', answer: '', image: '' }
  zoomImage.value = ''
  clearPendingImage()
}

/** 保存：先上传图片（幂等，服务端按内容返回 id），成功后再落库；失败保留弹窗与预览供重试 */
async function add() {
  if (!form.value.content && !pendingImage.value) {
    toast('请填写题目内容或上传图片')
    return
  }
  saving.value = true
  try {
    let image = ''
    if (pendingImage.value) {
      const id = await uploadErrorImage(pendingImage.value.bytes)
      image = ERROR_IMAGE_PREFIX + id
    }
    store.addErrorQuestion({ ...form.value, image, date: today() })
    // 先复位 saving 再关闭：closeModal 的 saving 守卫用于拦截「上传中」的关闭，成功路径需先复位
    saving.value = false
    closeModal()
    toast('错题已收录')
  } catch {
    toast('图片上传失败，请检查网络后重试')
  } finally {
    saving.value = false
  }
}

const expandedAnswer = ref<Record<string, boolean>>({})
const reviewCount = computed(() => store.errorQuestions.reduce((s, e) => s + e.reviewCount, 0))

// 图片灯箱：点击错题图片全屏放大查看，点击任意处或按 Esc 关闭
const zoomImage = ref('')
function openZoom(src: string) {
  zoomImage.value = src
}
function closeZoom() {
  zoomImage.value = ''
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeZoom()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
onUnmounted(clearPendingImage)

function removeError(id: string) {
  if (!window.confirm('确认删除这道错题？')) return
  store.deleteError(id)
  toast('已删除')
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">错题本</h1>
      <button class="btn-primary" @click="showModal = true">+ 收录错题</button>
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div class="card !p-3 text-center">
        <div class="text-xl font-black text-red-400">{{ store.errorQuestions.length }}</div>
        <div class="text-[11px] text-slate-400">错题总数</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-xl font-black text-emerald-500">
          {{ store.errorQuestions.filter((e) => e.mastered).length }}
        </div>
        <div class="text-[11px] text-slate-400">已攻克</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-xl font-black text-primary-500">{{ reviewCount }}</div>
        <div class="text-[11px] text-slate-400">复习次数</div>
      </div>
    </div>

    <div class="flex gap-2 items-center flex-wrap">
      <select v-model="filterSubject" class="input !w-auto">
        <option value="">全部科目</option>
        <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ subjectLabel(s) }}</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-slate-500 cursor-pointer">
        <input type="checkbox" v-model="showOnlyUnmastered" class="accent-primary-500" /> 只看未攻克
      </label>
    </div>

    <div v-if="!list.length" class="card text-center text-slate-400 text-sm py-10">暂无错题，继续保持！</div>

    <div class="space-y-3">
      <div v-for="q in list" :key="q.id" class="card" :class="q.mastered ? 'opacity-60' : ''">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-2 flex-wrap">
          <span>{{ subjectLabel(store.subjectMap[q.subjectId]) }}</span>
          <span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">{{ q.type }}</span>
          <span v-if="q.chapter">{{ q.chapter }}</span>
          <span>{{ q.date }}</span>
          <span v-if="q.mastered" class="text-emerald-500 font-semibold">✓ 已攻克</span>
        </div>
        <p class="text-sm whitespace-pre-wrap">{{ q.content }}</p>
        <RemoteImage
          v-if="q.image"
          :image="q.image"
          img-class="mt-2 max-h-48 rounded-lg border border-slate-100 dark:border-slate-700 cursor-zoom-in"
          alt="错题图片（点击放大）"
          @open="openZoom"
        />
        <div v-if="q.answer" class="mt-2">
          <button class="text-xs text-primary-500" @click="expandedAnswer[q.id] = !expandedAnswer[q.id]">
            {{ expandedAnswer[q.id] ? '收起解析 ▲' : '查看解析 ▼' }}
          </button>
          <p
            v-if="expandedAnswer[q.id]"
            class="text-sm text-slate-500 mt-1 bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 whitespace-pre-wrap"
          >
            {{ q.answer }}
          </p>
        </div>
        <div class="flex gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
          <button
            class="btn-ghost !py-1 !text-xs"
            @click="
              () => {
                store.reviewError(q.id)
                toast('复习 +1，积分 +2')
              }
            "
          >
            复习({{ q.reviewCount }})
          </button>
          <button class="btn-ghost !py-1 !text-xs" @click="store.toggleErrorMastered(q.id)">
            {{ q.mastered ? '↩ 取消攻克' : '✅ 标记攻克' }}
          </button>
          <button class="btn-ghost !py-1 !text-xs" @click="shareTarget = q.id">分享给搭子</button>
          <button class="btn-danger !py-1 !text-xs ml-auto" @click="removeError(q.id)">删除</button>
        </div>
      </div>
    </div>

    <Modal title="收录错题" :show="showModal" @close="closeModal">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">科目</label>
            <select v-model="form.subjectId" class="input">
              <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ subjectLabel(s) }}</option>
            </select>
          </div>
          <div>
            <label class="label">题型</label>
            <select v-model="form.type" class="input">
              <option v-for="t in currentTypes" :key="t.key" :value="t.label">{{ t.label }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="label">所属章节</label>
          <div class="grid grid-cols-2 gap-2">
            <select v-model="chapterPick.chapterName" class="input" @change="onChapterNamePick">
              <option value="">选择章节</option>
              <option v-for="c in currentSubject?.chapters ?? []" :key="c.id" :value="c.name">{{ c.name }}</option>
            </select>
            <select v-model="chapterPick.topicName" class="input" @change="onTopicPick">
              <option value="">选择知识点</option>
              <option v-for="t in currentChapterTopics" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <input v-model="form.chapter" class="input mt-2" placeholder="或手动输入章节内容…" />
        </div>
        <div>
          <label class="label">题目内容</label
          ><textarea v-model="form.content" rows="3" class="input" placeholder="题干描述…"></textarea>
        </div>
        <div>
          <label class="label">解析/正确答案</label
          ><textarea v-model="form.answer" rows="3" class="input" placeholder="正确解法、易错点…"></textarea>
        </div>
        <div>
          <label class="label">拍照上传（自动压缩，原图 ≤10MB）</label>
          <input type="file" accept="image/*" class="text-xs" :disabled="saving" @change="onImage" />
          <img
            v-if="pendingImage"
            :src="pendingImage.preview"
            class="mt-2 max-h-32 rounded-lg cursor-zoom-in"
            alt="预览（点击放大）"
            title="点击放大查看"
            @click="openZoom(pendingImage.preview)"
          />
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" :disabled="saving" @click="closeModal">取消</button>
        <button class="btn-primary" :disabled="saving" @click="add">{{ saving ? '上传中…' : '保存' }}</button>
      </template>
    </Modal>

    <!-- 分享给搭子弹窗 -->
    <PartnerShareModal v-if="shareTarget" item-type="error" :item-id="shareTarget" @close="shareTarget = ''" />

    <!-- 图片灯箱：全屏放大查看，点击任意处或按 Esc 关闭 -->
    <Teleport to="body">
      <div
        v-if="zoomImage"
        class="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        @click="closeZoom"
      >
        <img :src="zoomImage" class="max-w-full max-h-full object-contain rounded-lg select-none" alt="放大查看" />
        <span class="absolute top-3 right-4 text-white/70 text-sm select-none">点击任意处关闭 · Esc</span>
      </div>
    </Teleport>
  </div>
</template>
