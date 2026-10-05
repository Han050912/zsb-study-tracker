<script setup lang="ts">
/** 自定义励志名言卡：新增/删除名言（经 store action 统一改 state + 保存） */
import { computed, ref } from 'vue'
import { useAppStore } from '../../stores/app'
import { useToast } from '../../composables/useToast'

const store = useAppStore()
const toast = useToast()
const s = computed(() => store.settings)

// ---- 名言管理 ----
const newQuote = ref('')
function addQuote() {
  const q = newQuote.value.trim()
  if (!q) {
    toast('请先填写一句话')
    return
  }
  if (q.length > 200) {
    toast('单条自定义引言最多 200 字')
    return
  }
  // 经 store action 更新：action 内完成「改 state + 打 updatedAt + stage settings/self + save()」
  store.updateQuotes([...s.value.quotes, q])
  newQuote.value = ''
}
function removeQuote(index: number) {
  store.updateQuotes(s.value.quotes.filter((_, i) => i !== index))
}
</script>

<template>
  <!-- 名言 -->
  <div class="card space-y-3">
    <div class="section-title">自定义励志名言</div>
    <div class="flex gap-2">
      <input
        v-model="newQuote"
        maxlength="200"
        class="input"
        aria-label="写一句激励自己的话…"
        placeholder="写一句激励自己的话…"
        @keyup.enter="addQuote"
      />
      <button class="btn-ghost shrink-0" @click="addQuote">添加</button>
    </div>
    <div class="space-y-1 max-h-40 overflow-y-auto">
      <div v-for="(q, i) in s.quotes" :key="i" class="flex items-center gap-2 text-xs group">
        <span class="flex-1 text-slate-500 dark:text-slate-400">{{ q }}</span>
        <button class="min-w-9 min-h-9 text-correction" :aria-label="`删除引言：${q}`" @click="removeQuote(i)">
          ×
        </button>
      </div>
    </div>
  </div>
</template>
