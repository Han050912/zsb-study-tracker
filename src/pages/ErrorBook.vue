<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { today } from '../utils/date'
import Modal from '../components/Modal.vue'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const filterSubject = ref('')
const showOnlyUnmastered = ref(false)

const list = computed(() => {
  let l = store.errorQuestions.slice().reverse()
  if (filterSubject.value) l = l.filter(e => e.subjectId === filterSubject.value)
  if (showOnlyUnmastered.value) l = l.filter(e => !e.mastered)
  return l
})

const showModal = ref(false)
const form = ref({ subjectId: 'math', chapter: '', type: '选择' as const, content: '', answer: '', image: '' })

function onImage(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 500 * 1024) { toast('图片请小于 500KB（localStorage 限制）'); return }
  const reader = new FileReader()
  reader.onload = () => { form.value.image = reader.result as string }
  reader.readAsDataURL(file)
}

function add() {
  if (!form.value.content && !form.value.image) { toast('请填写题目内容或上传图片'); return }
  store.addErrorQuestion({ ...form.value, date: today() })
  showModal.value = false
  form.value = { subjectId: 'math', chapter: '', type: '选择', content: '', answer: '', image: '' }
  toast('错题已收录')
}

const expandedAnswer = ref<Record<string, boolean>>({})
const reviewCount = computed(() => store.errorQuestions.reduce((s, e) => s + e.reviewCount, 0))

function removeError(id: string) {
  if (!window.confirm('确认删除这道错题？')) return
  store.deleteError(id)
  toast('已删除')
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">📕 错题本</h1>
      <button class="btn-primary" @click="showModal = true">+ 收录错题</button>
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div class="card !p-3 text-center"><div class="text-xl font-black text-red-400">{{ store.errorQuestions.length }}</div><div class="text-[11px] text-slate-400">错题总数</div></div>
      <div class="card !p-3 text-center"><div class="text-xl font-black text-emerald-500">{{ store.errorQuestions.filter(e => e.mastered).length }}</div><div class="text-[11px] text-slate-400">已攻克</div></div>
      <div class="card !p-3 text-center"><div class="text-xl font-black text-primary-500">{{ reviewCount }}</div><div class="text-[11px] text-slate-400">复习次数</div></div>
    </div>

    <div class="flex gap-2 items-center flex-wrap">
      <select v-model="filterSubject" class="input !w-auto">
        <option value="">全部科目</option>
        <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.icon }} {{ s.name }}</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-slate-500 cursor-pointer">
        <input type="checkbox" v-model="showOnlyUnmastered" class="accent-primary-500" /> 只看未攻克
      </label>
    </div>

    <div v-if="!list.length" class="card text-center text-slate-400 text-sm py-10">暂无错题，继续保持！🎉</div>

    <div class="space-y-3">
      <div v-for="q in list" :key="q.id" class="card" :class="q.mastered ? 'opacity-60' : ''">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-2 flex-wrap">
          <span>{{ store.subjectMap[q.subjectId]?.icon }} {{ store.subjectMap[q.subjectId]?.name }}</span>
          <span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">{{ q.type }}</span>
          <span v-if="q.chapter">{{ q.chapter }}</span>
          <span>{{ q.date }}</span>
          <span v-if="q.mastered" class="text-emerald-500 font-semibold">✓ 已攻克</span>
        </div>
        <p class="text-sm whitespace-pre-wrap">{{ q.content }}</p>
        <img v-if="q.image" :src="q.image" class="mt-2 max-h-48 rounded-lg border border-slate-100 dark:border-slate-700" alt="错题图片" />
        <div v-if="q.answer" class="mt-2">
          <button class="text-xs text-primary-500" @click="expandedAnswer[q.id] = !expandedAnswer[q.id]">
            {{ expandedAnswer[q.id] ? '收起解析 ▲' : '查看解析 ▼' }}
          </button>
          <p v-if="expandedAnswer[q.id]" class="text-sm text-slate-500 mt-1 bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 whitespace-pre-wrap">{{ q.answer }}</p>
        </div>
        <div class="flex gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
          <button class="btn-ghost !py-1 !text-xs" @click="store.reviewError(q.id); toast('复习 +1，积分 +2')">🔄 复习({{ q.reviewCount }})</button>
          <button class="btn-ghost !py-1 !text-xs" @click="store.toggleErrorMastered(q.id)">{{ q.mastered ? '↩ 取消攻克' : '✅ 标记攻克' }}</button>
          <button class="btn-danger !py-1 !text-xs ml-auto" @click="removeError(q.id)">删除</button>
        </div>
      </div>
    </div>

    <Modal title="收录错题" :show="showModal" @close="showModal = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">科目</label>
            <select v-model="form.subjectId" class="input">
              <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.icon }} {{ s.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">题型</label>
            <select v-model="form.type" class="input">
              <option>选择</option><option>填空</option><option>计算</option><option>证明</option><option>其他</option>
            </select>
          </div>
        </div>
        <div><label class="label">所属章节</label><input v-model="form.chapter" class="input" placeholder="如：第三章 微分中值定理" /></div>
        <div><label class="label">题目内容</label><textarea v-model="form.content" rows="3" class="input" placeholder="题干描述…"></textarea></div>
        <div><label class="label">解析/正确答案</label><textarea v-model="form.answer" rows="3" class="input" placeholder="正确解法、易错点…"></textarea></div>
        <div>
          <label class="label">拍照上传（≤500KB）</label>
          <input type="file" accept="image/*" class="text-xs" @change="onImage" />
          <img v-if="form.image" :src="form.image" class="mt-2 max-h-32 rounded-lg" alt="预览" />
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="showModal = false">取消</button>
        <button class="btn-primary" @click="add">保存</button>
      </template>
    </Modal>
  </div>
</template>
