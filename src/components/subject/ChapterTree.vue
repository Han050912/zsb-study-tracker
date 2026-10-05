<script setup lang="ts">
import IconAction from '../../shared/components/IconAction.vue'
import { ChevronDown, ChevronUp, Pencil, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { useAppStore } from '../../stores/app'
import StarRating from '../StarRating.vue'
import Modal from '../Modal.vue'
import EnhancedRadarChart from '../EnhancedRadarChart.vue'
import type { TopicImportance } from '../../types'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()
const toast = useToast()
const confirm = useConfirm()

const subject = computed(() => store.subjectMap[props.subjectId])

// ---- 掌握度雷达（支持超过8个知识点，按章节分组） ----
const radarChapters = computed(() => {
  const s = subject.value
  if (!s) return []

  // 按章节组织数据
  return s.chapters.map((ch) => ({
    chapterId: ch.id,
    chapterName: ch.name,
    topics: ch.topics.map((topic) => ({
      name: topic,
      value: s.mastery[topic] || 0,
      max: 5,
      importance: s.topicImportance[topic] || 'normal'
    }))
  }))
})

const router = useRouter()
/** 跳转知识点讨论区（P2-6）：以「科目 + 章节」为讨论单元 */
function openTopicDiscussion(chapterName: string) {
  router.push({ path: `/community/topic/${props.subjectId}`, query: { chapter: chapterName } })
}

// ---- 章节管理 ----
const newChapter = ref('')
function addChapter() {
  if (!newChapter.value.trim()) return
  store.addChapter(props.subjectId, newChapter.value.trim())
  newChapter.value = ''
  toast('章节已添加，展开后可添加知识点')
}

// ---- 章节标题行内编辑（双击标题或点击编辑按钮进入编辑态） ----
const editingChapterId = ref('')
const editingChapterName = ref('')
/** 输入框挂载后自动聚焦并全选，提升编辑流畅度 */
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus()
    el.select()
  }
}
function startEditChapter(ch: { id: string; name: string }) {
  editingChapterId.value = ch.id
  editingChapterName.value = ch.name
}
function saveChapterName(chapterId: string) {
  // Enter 与 blur 可能连续触发，幂等守卫避免重复保存
  if (editingChapterId.value !== chapterId) return
  const name = editingChapterName.value.trim()
  const oldName = subject.value?.chapters.find((c) => c.id === chapterId)?.name
  if (name && name !== oldName) {
    if (store.updateChapter(props.subjectId, chapterId, name)) toast('章节标题已更新')
  }
  editingChapterId.value = ''
}
function cancelEditChapter() {
  editingChapterId.value = ''
}

// ---- 知识点（小标题）管理 ----
const newTopic = ref<Record<string, string>>({})
function addTopic(chapterId: string) {
  const t = (newTopic.value[chapterId] || '').trim()
  if (!t) return
  store.addTopic(props.subjectId, chapterId, t)
  newTopic.value[chapterId] = ''
  toast('知识点已添加')
}
function removeTopic(chapterId: string, topic: string) {
  store.removeTopic(props.subjectId, chapterId, topic)
  toast('已删除')
}

// ---- 知识点重要程度 + 双击编辑 ----
const IMPORTANCE_OPTIONS: { k: TopicImportance; l: string; cls: string }[] = [
  { k: 'normal', l: '普通', cls: 'text-slate-400 bg-slate-100 dark:bg-slate-700' },
  { k: 'important', l: '重要', cls: 'text-muted bg-surface-soft' },
  { k: 'must', l: '必考', cls: 'text-correction bg-correction-soft' }
]
function importanceOf(topic: string): TopicImportance {
  return subject.value?.topicImportance?.[topic] || 'normal'
}
function importanceMeta(topic: string) {
  return IMPORTANCE_OPTIONS.find((o) => o.k === importanceOf(topic)) || IMPORTANCE_OPTIONS[0]
}

const showTopicModal = ref(false)
const editTopic = ref<{ chapterId: string; old: string; text: string; importance: TopicImportance }>({
  chapterId: '',
  old: '',
  text: '',
  importance: 'normal'
})
function openTopicEdit(chapterId: string, topic: string) {
  editTopic.value = { chapterId, old: topic, text: topic, importance: importanceOf(topic) }
  showTopicModal.value = true
}
function saveTopicEdit() {
  const text = editTopic.value.text.trim()
  if (!text) {
    toast('知识点内容不能为空')
    return
  }
  const ok = store.updateTopic(
    props.subjectId,
    editTopic.value.chapterId,
    editTopic.value.old,
    text,
    editTopic.value.importance
  )
  if (!ok) {
    toast('保存失败：与本章节其他知识点重名')
    return
  }
  showTopicModal.value = false
  toast('知识点已更新')
}
async function removeChapter(chapterId: string) {
  if (!(await confirm('删除该章节及其全部知识点？', { danger: true }))) return
  store.removeChapter(props.subjectId, chapterId)
  toast('章节已删除')
}

const expanded = ref<Record<string, boolean>>({})
</script>

<template>
  <!-- 章节树 + 掌握度 -->
  <div v-if="radarChapters.length" class="card">
    <EnhancedRadarChart :chapters="radarChapters" :color="subject?.color" title="知识点自评" />
  </div>
  <div class="card">
    <div class="section-title">章节知识点</div>
    <p class="study-note mb-3">展开章节后点击星星自评；编辑按钮可修改名称与重要程度。</p>
    <div class="space-y-1">
      <div
        v-for="ch in subject.chapters"
        :key="ch.id"
        class="border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden"
      >
        <div class="flex items-center gap-1 px-3 py-1">
          <input
            v-if="editingChapterId === ch.id"
            v-model="editingChapterName"
            v-focus
            class="input flex-1 min-w-0 !font-medium"
            aria-label="章节标题"
            @keyup.enter.stop="saveChapterName(ch.id)"
            @keyup.esc="cancelEditChapter"
            @blur="saveChapterName(ch.id)"
          />
          <span
            v-else
            class="flex-1 min-w-0 min-h-11 flex items-center gap-2 text-left text-sm font-medium arrow-action"
            @click="expanded[ch.id] = !expanded[ch.id]"
          >
            <IconAction
              :icon="expanded[ch.id] ? ChevronUp : ChevronDown"
              :label="`${ch.name} ${ch.topics.length} 个知识点`"
              :aria-expanded="!!expanded[ch.id]"
              :aria-controls="`chapter-${subjectId}-${ch.id}`"
              class="shrink-0 transition-transform duration-150"
              @click="expanded[ch.id] = !expanded[ch.id]"
            />
            <span class="break-words">{{ ch.name }}</span>
            <span class="hidden sm:inline text-xs text-slate-400 whitespace-nowrap"
              >{{ ch.topics.length }} 个知识点</span
            >
          </span>
          <button
            type="button"
            class="icon-button text-slate-400 hover:text-action"
            title="编辑章节标题"
            aria-label="编辑章节标题"
            @click="startEditChapter(ch)"
          >
            <Pencil :size="15" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="min-h-11 px-1 text-action text-xs hover:underline"
            @click="openTopicDiscussion(ch.name)"
          >
            讨论
          </button>
          <button
            type="button"
            class="min-h-11 px-1 text-correction text-xs hover:underline"
            @click="removeChapter(ch.id)"
          >
            删除
          </button>
        </div>
        <div v-if="expanded[ch.id]" :id="`chapter-${subjectId}-${ch.id}`" class="panel-reveal px-3 pb-2 space-y-1.5">
          <div v-if="!ch.topics.length" class="text-xs text-slate-400 py-1">先在下方添加知识点，再记录自评。</div>
          <div
            v-for="topic in ch.topics"
            :key="topic"
            class="flex flex-wrap items-center justify-between gap-2 text-sm py-1 group"
          >
            <span
              class="text-slate-600 dark:text-slate-300 flex items-center gap-2 min-w-0"
              title="双击编辑知识点内容与重要程度"
              @dblclick="openTopicEdit(ch.id, topic)"
            >
              <button
                class="study-link text-left text-sm"
                :aria-label="`编辑知识点：${topic}`"
                @click="openTopicEdit(ch.id, topic)"
              >
                {{ topic }}
              </button>
              <span
                v-if="importanceOf(topic) !== 'normal'"
                class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                :class="importanceMeta(topic).cls"
              >
                {{ importanceMeta(topic).l }}
              </span>
              <button
                class="icon-button text-correction text-xs"
                title="删除知识点"
                @click.stop="removeTopic(ch.id, topic)"
                @dblclick.stop
              >
                <X :size="14" aria-hidden="true" />
              </button>
            </span>
            <StarRating
              :label="`${topic}自评`"
              :model-value="subject.mastery[topic] || 0"
              @update:model-value="(v) => store.setMastery(subject.id, topic, v)"
            />
          </div>
          <!-- 添加知识点 -->
          <div class="flex gap-2 pt-1">
            <input
              v-model="newTopic[ch.id]"
              class="input !py-1 !text-xs"
              placeholder="添加知识点小标题，如：洛必达法则"
              @keyup.enter="addTopic(ch.id)"
            />
            <button class="btn-ghost !py-1 !text-xs shrink-0" @click="addTopic(ch.id)">+ 添加</button>
          </div>
        </div>
      </div>
    </div>
    <div class="flex gap-2 mt-3">
      <input v-model="newChapter" class="input" placeholder="自定义添加章节…" @keyup.enter="addChapter" />
      <button class="btn-ghost shrink-0" @click="addChapter">添加</button>
    </div>
  </div>

  <!-- 知识点编辑弹窗（双击知识点唤起） -->
  <Modal title="编辑知识点" :show="showTopicModal" @close="showTopicModal = false">
    <div class="space-y-3">
      <div>
        <label class="label">知识点内容</label>
        <input v-model="editTopic.text" class="input" placeholder="知识点名称" @keyup.enter="saveTopicEdit" />
      </div>
      <div>
        <label class="label">重要程度</label>
        <div class="flex gap-2">
          <button
            v-for="o in IMPORTANCE_OPTIONS"
            :key="o.k"
            type="button"
            class="flex-1 text-xs px-3 py-2 rounded-lg font-medium transition-all"
            :class="[o.cls, editTopic.importance === o.k ? 'ring-2 ring-primary-400' : 'opacity-60 hover:opacity-100']"
            @click="editTopic.importance = o.k"
          >
            {{ o.l }}
          </button>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showTopicModal = false">取消</button>
      <button class="btn-primary" @click="saveTopicEdit">保存</button>
    </template>
  </Modal>
</template>
