<script setup lang="ts">
import EmptyState from '../../shared/components/EmptyState.vue'
/** 作文模板面板：分类模板库列表 + 新增/编辑弹窗（含内置模板一键生成）；数据直接读写 app store */
import { computed, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import Modal from '../Modal.vue'
import { BUILTIN_TEMPLATES } from '../../data/englishTemplates'

const store = useAppStore()
const toast = useToast()
const eng = computed(() => store.english)

// ---- 作文模板（三大分类：议论文/图表文/信件文 + 自定义） ----
const TPL_CATEGORIES = ['议论文', '图表文', '信件文', '自定义']
const showTpl = ref(false)
const tplForm = ref<{ id: string; title: string; content: string; level: number; category?: string }>({
  id: '',
  title: '',
  content: '',
  level: 0,
  category: '自定义'
})
function openTpl(t?: any) {
  tplForm.value = t ? { category: '自定义', ...t } : { id: '', title: '', content: '', level: 0, category: '自定义' }
  showTpl.value = true
}
function saveTpl() {
  if (!showTpl.value) return
  const title = tplForm.value.title.trim()
  if (!title || !tplForm.value.content.trim()) {
    toast(!title ? '请填写模板标题' : '请填写模板内容')
    return
  }
  // 经 store action 保存：action 内完成「改 state + 打 updatedAt + stage english/template:<id> + save()」
  store.saveEssayTemplate({ ...tplForm.value, title })
  showTpl.value = false
  toast('模板已保存')
}
function delTpl(id: string) {
  store.deleteEssayTemplate(id)
}

/** 一键生成内置参考模板库（按标题去重，可重复点击补全缺失项） */
function generateBuiltin() {
  const existing = new Set(eng.value.templates.map((t) => t.title))
  const missing = BUILTIN_TEMPLATES.filter((bt) => !existing.has(bt.title))
  if (!missing.length) {
    toast('内置模板已全部生成，无需重复添加')
    return
  }
  for (const bt of missing) {
    store.saveEssayTemplate({ title: bt.title, content: bt.content, level: 0, category: bt.category })
  }
  toast(`已生成 ${missing.length} 套内置参考模板`)
}

/** 按分类分组展示（旧数据无 category 归入「自定义」） */
const tplGroups = computed(() =>
  TPL_CATEGORIES.map((cat) => ({
    cat,
    items: eng.value.templates.filter((t) => (t.category || '自定义') === cat)
  })).filter((g) => g.items.length)
)
</script>

<template>
  <div class="card">
    <div class="flex justify-between items-center mb-3 flex-wrap gap-2">
      <div class="section-title !mb-0">作文模板库</div>
      <div class="flex gap-2">
        <button
          class="btn-ghost !py-1.5"
          title="一键生成 议论文×5 / 图表文×2 / 信件文×3 参考模板"
          @click="generateBuiltin"
        >
          生成内置模板库
        </button>
        <button class="btn-primary !py-1.5" @click="openTpl()">+ 自定义模板</button>
      </div>
    </div>
    <EmptyState v-if="!eng.templates.length" title="还没有作文模板。可以新建自己的模板，或生成 10 套内置参考模板。" />
    <!-- 分分类多列布局 -->
    <div v-for="g in tplGroups" :key="g.cat" class="mb-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs font-bold px-2 py-0.5 rounded-full" :class="'bg-surface-soft text-muted'">{{
          g.cat
        }}</span>
        <span class="text-[10px] text-slate-400">{{ g.items.length }} 套</span>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div
          v-for="t in g.items"
          :key="t.id"
          class="border border-slate-100 dark:border-slate-700 rounded-lg p-3 cursor-pointer hover:bg-surface-soft"
          @click="openTpl(t)"
        >
          <div class="flex items-center justify-between gap-2">
            <button class="study-link text-left font-medium text-xs flex-1" @click.stop="openTpl(t)">
              {{ t.title }}
            </button>
            <span class="text-muted text-[10px] shrink-0">{{ '★'.repeat(t.level) || '未评级' }}</span>
          </div>
          <p class="text-[11px] text-slate-400 line-clamp-3 mt-1.5 whitespace-pre-line">{{ t.content }}</p>
        </div>
      </div>
    </div>
  </div>

  <Modal title="作文模板" :show="showTpl" @close="showTpl = false">
    <div class="space-y-3">
      <input v-model="tplForm.title" class="input" placeholder="模板标题，如：议论文开头万能句" />
      <div>
        <div class="label">分类</div>
        <div class="flex gap-2">
          <button
            v-for="c in TPL_CATEGORIES"
            :key="c"
            type="button"
            class="flex-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-all"
            :class="
              tplForm.category === c ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
            "
            @click="tplForm.category = c"
          >
            {{ c }}
          </button>
        </div>
      </div>
      <textarea v-model="tplForm.content" rows="8" class="input !text-xs font-mono" placeholder="模板内容…"></textarea>
      <div>
        <div class="label">掌握程度</div>
        <div class="flex gap-1">
          <button
            v-for="i in 5"
            :key="i"
            class="text-2xl"
            :class="i <= tplForm.level ? 'text-muted' : 'text-slate-300'"
            @click="tplForm.level = i"
          >
            ★
          </button>
        </div>
      </div>
    </div>
    <template #footer>
      <button
        v-if="tplForm.id"
        class="btn-danger mr-auto"
        @click="
          () => {
            delTpl(tplForm.id)
            showTpl = false
          }
        "
      >
        删除
      </button>
      <button class="btn-ghost" @click="showTpl = false">取消</button>
      <button class="btn-primary" @click="saveTpl">保存</button>
    </template>
  </Modal>
</template>
