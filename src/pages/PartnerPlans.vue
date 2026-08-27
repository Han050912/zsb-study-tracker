<script setup lang="ts">
/**
 * 协作备考计划：
 * - 列表视图：我的计划（标题/搭子/我的进度 myDone-taskTotal），点进详情
 * - 新建计划：选择搭子（?partner= 可预选）+ 标题 → createPartnerPlan
 * - 详情视图：任务列表（标题/阶段/「我完成」可勾选 /「搭子完成」只读）、添加任务、删除任务、删除计划
 */
import { inject, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { communityApi } from '../api/community'
import { useBack } from '../composables/useBack'
import type { PartnerItem, PartnerPlan, PartnerPlanDetail, PartnerPlanTask } from '../types'

const route = useRoute()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})

const loading = ref(true)
const plans = ref<PartnerPlan[]>([])
const partners = ref<PartnerItem[]>([])

// ---- 新建计划 ----
const newPartner = ref((route.query.partner as string) || '')
const newTitle = ref('')
const creating = ref(false)

// ---- 详情视图 ----
const detail = ref<PartnerPlanDetail | null>(null)
const detailLoading = ref(false)
const newTaskTitle = ref('')
const newTaskPhase = ref('')

onMounted(async () => {
  loading.value = true
  try {
    const [p, l] = await Promise.all([communityApi.partnerPlans(), communityApi.partners()])
    plans.value = p.items
    partners.value = l.partners
    if (newPartner.value && !l.partners.some(x => x.userId === newPartner.value)) newPartner.value = ''
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
})

async function loadPlans() {
  try {
    plans.value = (await communityApi.partnerPlans()).items
  } catch (e: any) {
    toast(e?.message || '加载失败')
  }
}

async function createPlan() {
  if (creating.value) return
  if (!newPartner.value) { toast('请选择搭子'); return }
  if (!newTitle.value.trim()) { toast('请输入计划标题'); return }
  creating.value = true
  try {
    await communityApi.createPartnerPlan(newPartner.value, newTitle.value.trim())
    newTitle.value = ''
    toast('计划已创建')
    await loadPlans()
  } catch (e: any) {
    toast(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function openDetail(id: string) {
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await communityApi.partnerPlan(id)
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    detailLoading.value = false
  }
}

function backToList() {
  detail.value = null
  loadPlans()
}

async function refreshDetail() {
  if (!detail.value) return
  try {
    detail.value = await communityApi.partnerPlan(detail.value.id)
  } catch (e: any) {
    toast(e?.message || '刷新失败')
  }
}

async function toggleTask(t: PartnerPlanTask, done: boolean) {
  if (!detail.value) return
  try {
    await communityApi.updatePlanTask(detail.value.id, t.id, done)
    t.myDone = done
  } catch (e: any) {
    toast(e?.message || '操作失败')
    await refreshDetail()
  }
}

async function addTask() {
  if (!detail.value) return
  if (!newTaskTitle.value.trim()) { toast('请输入任务标题'); return }
  try {
    await communityApi.addPlanTask(detail.value.id, newTaskTitle.value.trim(), newTaskPhase.value.trim())
    newTaskTitle.value = ''
    newTaskPhase.value = ''
    await refreshDetail()
  } catch (e: any) {
    toast(e?.message || '添加失败')
  }
}

async function removeTask(t: PartnerPlanTask) {
  if (!detail.value) return
  if (!window.confirm(`删除任务「${t.title}」？`)) return
  try {
    await communityApi.deletePlanTask(detail.value.id, t.id)
    toast('任务已删除')
    await refreshDetail()
  } catch (e: any) {
    toast(e?.message || '删除失败')
  }
}

async function removePlan() {
  if (!detail.value) return
  if (!window.confirm(`删除计划「${detail.value.title}」？其中的任务将一并删除。`)) return
  try {
    await communityApi.deletePartnerPlan(detail.value.id)
    toast('计划已删除')
    detail.value = null
    await loadPlans()
  } catch (e: any) {
    toast(e?.message || '删除失败')
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
    <div class="section-title !mb-0">协作备考计划</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <!-- 详情视图 -->
    <template v-else-if="detail || detailLoading">
      <div class="card space-y-3">
        <div v-if="detailLoading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
        <template v-else-if="detail">
          <div class="flex items-center gap-2">
            <button class="btn-ghost !text-xs !px-2" @click="backToList">← 列表</button>
            <div class="min-w-0">
              <div class="text-sm font-semibold truncate">{{ detail.title }}</div>
              <div class="text-[10px] text-slate-400">与「{{ detail.partnerName }}」协作</div>
            </div>
            <button class="ml-auto btn-danger !text-xs shrink-0" @click="removePlan">删除计划</button>
          </div>

          <div v-if="!detail.tasks.length" class="text-xs text-slate-400 text-center py-6">还没有任务，在下方添加第一个任务吧</div>
          <div v-for="t in detail.tasks" :key="t.id"
            class="flex items-center gap-2 text-xs border-b border-slate-50 dark:border-slate-700 last:border-0 py-2 flex-wrap">
            <div class="min-w-0">
              <div class="font-medium" :class="t.myDone ? 'line-through text-slate-400' : ''">{{ t.title }}</div>
              <div v-if="t.phase" class="text-[10px] text-slate-400">{{ t.phase }}</div>
            </div>
            <label class="ml-auto flex items-center gap-1 cursor-pointer shrink-0">
              <input type="checkbox" :checked="t.myDone" class="accent-primary-500"
                @change="toggleTask(t, ($event.target as HTMLInputElement).checked)" /> 我完成
            </label>
            <label class="flex items-center gap-1 text-slate-400 shrink-0" title="仅搭子本人可勾选">
              <input type="checkbox" :checked="t.partnerDone" disabled class="accent-primary-500" /> 搭子完成
            </label>
            <button class="text-red-400 shrink-0" @click="removeTask(t)">删除</button>
          </div>

          <!-- 添加任务 -->
          <div class="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex-wrap">
            <input v-model="newTaskTitle" class="input flex-1 min-w-32 !text-xs" placeholder="任务标题，如：刷完第三章习题"
              maxlength="50" @keydown.enter="addTask" />
            <input v-model="newTaskPhase" class="input !w-28 !text-xs" placeholder="阶段（选填）" maxlength="20" @keydown.enter="addTask" />
            <button class="btn-primary !text-xs shrink-0" @click="addTask">添加任务</button>
          </div>
        </template>
      </div>
    </template>

    <!-- 列表视图 -->
    <template v-else>
      <!-- 新建计划 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">新建计划</div>
        <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-2">
          还没有搭子，先去<router-link to="/community/partners" class="text-primary-500">搭子页</router-link>添加一位吧
        </div>
        <div v-else class="flex gap-2 flex-wrap">
          <select v-model="newPartner" class="input !w-auto !text-xs">
            <option value="" disabled>选择搭子</option>
            <option v-for="p in partners" :key="p.userId" :value="p.userId">{{ p.userName }}</option>
          </select>
          <input v-model="newTitle" class="input flex-1 min-w-32 !text-xs" placeholder="计划标题，如：高数一轮复习"
            maxlength="30" @keydown.enter="createPlan" />
          <button class="btn-primary !text-xs shrink-0" :disabled="creating" @click="createPlan">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>

      <!-- 计划列表 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">我的计划（{{ plans.length }}）</div>
        <div v-if="!plans.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">还没有协作计划，在上方创建一个吧</div>
        <button v-for="p in plans" :key="p.id"
          class="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
          @click="openDetail(p.id)">
          <div class="min-w-0 text-left">
            <div class="font-medium truncate">{{ p.title }}</div>
            <div class="text-[10px] text-slate-400">与「{{ p.partnerName }}」协作</div>
          </div>
          <span class="ml-auto shrink-0 text-slate-400">我的进度 {{ p.myDone }}/{{ p.taskTotal }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
