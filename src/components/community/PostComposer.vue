<script setup lang="ts">
import { useComposer } from '../../features/community/composables/useComposer'
import type { PostType } from '../../types'
import Modal from '../Modal.vue'
import TagBadge from './TagBadge.vue'
import ImageUploadPreview from './ImageUploadPreview.vue'
import ComposerEditor from './ComposerEditor.vue'
const props = withDefaults(
  defineProps<{
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
  }>(),
  {
    presetContent: '',
    presetTags: () => [],
    circleId: undefined,
    topicRef: undefined,
    refType: undefined,
    refId: undefined,
    allowTypeSwitch: false,
    allowTemplate: false
  }
)

const emit = defineEmits<{ 'update:show': [boolean]; posted: [] }>()

const {
  QUESTION_SUBJECT_TAGS,
  IMAGE_ACCEPT,
  images,
  uploading,
  fileInput,
  pickImages,
  onFileChange,
  onPaste,
  onDrop,
  removeImage,
  retryImage,
  content,
  tags,
  subject,
  submitting,
  myCircles,
  selectedCircle,
  closePrompt,
  requestClose,
  closeWithDraft,
  isQuestion,
  placeholder,
  applyExperienceTemplate,
  switchType,
  toggleTag,
  submit,
  IMAGE_MAX_PER_POST,
  COMMUNITY_TAGS
} = useComposer(props, (event, value) => (event === 'posted' ? emit('posted') : emit('update:show', value ?? false)))
</script>

<template>
  <Modal
    :show="show"
    :title="isQuestion ? '提问' : '分享到广场'"
    panel-class="collaboration-page"
    @close="requestClose"
  >
    <!-- 类型切换（仅广场主入口） -->
    <div v-if="allowTypeSwitch" class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs mb-3 w-fit">
      <button
        class="px-3 py-1.5 rounded-md transition-colors"
        :class="
          !isQuestion ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'
        "
        @click="switchType('share')"
      >
        分享
      </button>
      <button
        class="px-3 py-1.5 rounded-md transition-colors"
        :class="
          isQuestion ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'
        "
        @click="switchType('question')"
      >
        ❓ 提问
      </button>
    </div>

    <ComposerEditor
      v-model="content"
      :placeholder="placeholder"
      :allow-template="allowTemplate && !isQuestion"
      @paste="onPaste"
      @drop="onDrop"
      @template="applyExperienceTemplate"
    />

    <!-- 图片区 -->
    <div class="mt-2">
      <div class="flex items-center gap-2">
        <button class="btn-ghost !text-xs" @click="pickImages">添加图片</button>
        <span class="text-[10px] text-slate-400"
          >点击 / 拖拽 / Ctrl+V 粘贴，最多 {{ IMAGE_MAX_PER_POST }} 张，单张 ≤5MB</span
        >
      </div>
      <input ref="fileInput" type="file" :accept="IMAGE_ACCEPT" multiple class="hidden" @change="onFileChange" />
      <ImageUploadPreview
        :images="images"
        list-class="grid grid-cols-3 gap-2 mt-2"
        item-class="relative aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700"
        size="md"
        @remove="removeImage"
        @retry="retryImage"
      />
    </div>

    <!-- 提问帖科目标签（必选，单选） -->
    <template v-if="isQuestion">
      <div class="label mt-2">科目标签（必选）</div>
      <div class="flex flex-wrap gap-1.5">
        <TagBadge
          v-for="t in QUESTION_SUBJECT_TAGS"
          :key="t"
          :tag="t"
          :active="subject === t"
          @click="subject = subject === t ? '' : t"
        />
      </div>
    </template>

    <div class="label mt-2">话题标签（最多 5 个）</div>
    <div class="flex flex-wrap gap-1.5">
      <TagBadge
        v-for="t in COMMUNITY_TAGS.filter((t) => !isQuestion || !QUESTION_SUBJECT_TAGS.includes(t))"
        :key="t"
        :tag="t"
        :active="tags.includes(t)"
        @click="toggleTag(t)"
      />
    </div>

    <!-- 圈子选择器（仅广场入口且已加入圈子、非讨论区发帖时展示；圈子帖不进公共广场） -->
    <template v-if="circleId === undefined && topicRef === undefined && myCircles.length">
      <div class="label mt-2">发布到（圈子帖仅圈内可见）</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          class="px-2.5 py-1 rounded-full text-xs transition-colors"
          :class="
            !selectedCircle
              ? 'bg-primary-500 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          "
          @click="selectedCircle = ''"
        >
          广场
        </button>
        <button
          v-for="c in myCircles"
          :key="c.id"
          class="px-2.5 py-1 rounded-full text-xs transition-colors"
          :class="
            selectedCircle === c.id
              ? 'bg-primary-500 text-white'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          "
          @click="selectedCircle = c.id"
        >
          {{ c.name }}
        </button>
      </div>
    </template>

    <template #footer>
      <button class="btn-ghost" @click="requestClose">取消</button>
      <button class="btn-primary" :disabled="submitting || uploading" @click="submit">
        {{ submitting ? '发布中…' : uploading ? '图片上传中…' : '发布' }}
      </button>
    </template>
  </Modal>
  <Modal :show="closePrompt" title="保留这次的想法？" elevated @close="closePrompt = false">
    <p class="text-sm text-slate-500">保留草稿后，下次发布时可以继续编辑。</p>
    <p v-if="uploading" class="text-sm mt-2">图片仍在上传，完成后可以保留。</p>
    <template #footer
      ><button class="btn-ghost" @click="closePrompt = false">继续编辑</button
      ><button class="btn-danger" @click="closeWithDraft(false)">放弃</button
      ><button class="btn-primary" :disabled="uploading" @click="closeWithDraft(true)">保留草稿</button></template
    >
  </Modal>
</template>
