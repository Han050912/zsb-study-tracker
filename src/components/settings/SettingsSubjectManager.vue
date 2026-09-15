<script setup lang="ts">
/** 科目管理卡：科目列表（权重/删除）+ 恢复默认确认、扩展科目弹窗 */
import { ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { useAppStore } from '../../stores/app'
import Modal from '../Modal.vue'
import { subjectLabel } from '../../utils/subject'

const store = useAppStore()
const toast = useToast()
const confirm = useConfirm()

// ---- 自定义科目 ----
const showSubject = ref(false)
const subForm = ref({ name: '', icon: '', color: '#8b5cf6', weight: 20 })
function addSubject() {
  if (!subForm.value.name.trim()) return
  store.addSubject({ ...subForm.value })
  showSubject.value = false
  subForm.value = { name: '', icon: '', color: '#8b5cf6', weight: 20 }
  toast('科目已添加，独立页面已生成')
}
/** 修改科目权重；无效/空输入恢复原值并提示 */
function onWeightChange(id: string, e: Event) {
  const input = e.target as HTMLInputElement
  const v = Number(input.value)
  if (input.value.trim() === '' || Number.isNaN(v)) {
    input.value = String(store.subjectMap[id]?.weight ?? 0)
    toast('权重输入无效，已恢复原值')
    return
  }
  store.updateSubjectWeight(id, v)
  input.value = String(store.subjectMap[id]?.weight ?? v)
  toast('权重已更新')
}

/** 删除任意科目（含内置），级联清理关联数据并回收对应积分，删除后对应科目页面自动隐藏 */
async function removeSubject(id: string, name: string) {
  const extra = id === 'english' ? '，英语专项数据（词汇/阅读/听力/作文模板）也将永久删除' : ''
  if (
    !(await confirm(
      `删除「${name}」？其学习记录、笔记、刷题、错题、真题将一并删除${extra}，相关积分同步回收，删除后该科目页面自动隐藏。`,
      { danger: true }
    ))
  )
    return
  store.removeSubject(id)
  toast('科目已删除，关联数据与积分已同步清理')
}

// ---- 恢复默认科目 ----
const showRestoreConfirm = ref(false)
function restoreDefaults() {
  const restored = store.restoreDefaultSubjects()
  showRestoreConfirm.value = false
  toast(restored > 0 ? `已恢复 ${restored} 个内置科目` : '内置科目均已存在，无需恢复')
}
</script>

<template>
  <!-- 科目管理 -->
  <div class="card space-y-3">
    <div class="flex items-center justify-between gap-2">
      <div class="section-title !mb-0">科目管理</div>
      <div class="flex items-center gap-2 shrink-0">
        <button class="btn-ghost !py-1.5 !text-xs" @click="showRestoreConfirm = true">恢复默认</button>
        <button class="btn-primary !py-1.5 !text-xs" @click="showSubject = true">+ 扩展科目</button>
      </div>
    </div>
    <div class="space-y-2">
      <div v-for="sub in store.subjects" :key="sub.id" class="flex items-center gap-2 text-sm flex-wrap">
        <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: sub.color }"></span>
        <span>{{ subjectLabel(sub) }}</span>
        <span v-if="sub.builtin" class="text-[10px] text-slate-400">（内置）</span>
        <span class="ml-auto flex items-center gap-1 text-xs text-slate-400">
          权重
          <input
            type="number"
            min="0"
            max="100"
            class="input !w-16 !py-0.5 !px-1.5 !text-xs"
            :value="sub.weight"
            title="修改权重百分比"
            @change="onWeightChange(sub.id, $event)"
          />
          %
        </span>
        <button class="text-xs text-red-400 shrink-0" @click="removeSubject(sub.id, sub.name)">删除</button>
      </div>
      <p class="text-[10px] text-slate-400">
        可自由增删科目、调整权重；删除科目后其独立页面自动隐藏，新增科目自动生成独立页面。权重为自定义考核占比配置（各科目之和不要求等于
        100%），统计图表仍按实际学习时长计算。
      </p>
    </div>
  </div>

  <!-- 恢复默认科目确认 -->
  <Modal title="恢复默认科目" :show="showRestoreConfirm" @close="showRestoreConfirm = false">
    <p class="text-sm text-slate-600 dark:text-slate-300">
      确定恢复默认科目列表？自定义新增的科目不会被删除，已删除的系统内置科目将会全部恢复。
    </p>
    <template #footer>
      <button class="btn-ghost" @click="showRestoreConfirm = false">取消</button>
      <button class="btn-primary" @click="restoreDefaults">确认恢复</button>
    </template>
  </Modal>

  <!-- 扩展科目弹窗 -->
  <Modal title="添加扩展科目" :show="showSubject" @close="showSubject = false">
    <div class="space-y-3">
      <div>
        <label class="label">科目名称</label
        ><input v-model="subForm.name" class="input" placeholder="如：计算机基础、政治、专业课" />
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div><label class="label">图标 emoji</label><input v-model="subForm.icon" class="input" maxlength="4" /></div>
        <div>
          <label class="label">颜色</label><input v-model="subForm.color" type="color" class="input !p-1 h-9" />
        </div>
        <div>
          <label class="label">考核权重%</label
          ><input v-model.number="subForm.weight" type="number" min="1" max="100" class="input" />
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="showSubject = false">取消</button>
      <button class="btn-primary" @click="addSubject">添加</button>
    </template>
  </Modal>
</template>
