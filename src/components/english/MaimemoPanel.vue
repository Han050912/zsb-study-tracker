<script setup lang="ts">
/**
 * 墨墨背单词同步卡：Token 保存就地完成（写 settings + 云端推送）；
 * 「同步今日背诵」会回写父页词汇表单并触发单词明细拉取（跨区块联动），只上抛 sync 意图由页面执行
 */
import { ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'

defineProps<{ syncing: boolean }>()
const emit = defineEmits<{ sync: [] }>()

const store = useAppStore()
const toast = useToast()

const maimemoToken = ref('') // 不回显明文；已配置状态见 store.settings.maimemoConnected
const saving = ref(false)
async function saveMaimemoToken() {
  if (saving.value) return
  const raw = maimemoToken.value.trim()
  if (!raw) {
    toast('请输入墨墨开放 API Token')
    return
  }
  saving.value = true
  store.updateSettings({ maimemoToken: raw })
  // 立即推送到云端（Worker 加密存储），不等待防抖；此处只改 settings（maimemoToken），无其它切片联动
  const ok = await store.saveAsync()
  if (ok) {
    // 明文不落前端状态：保存成功后清空输入，仅保留「已配置」标志
    store.updateSettings({ maimemoToken: undefined, maimemoConnected: true })
    maimemoToken.value = ''
    toast('墨墨 Token 已保存')
  } else {
    // 失败路径不保留明文：立即清空 store 中的 Token 并重新 stage（覆盖 outbox 中已落盘的明文），
    // 输入框内容保留，用户可直接点击「保存」重试
    store.updateSettings({ maimemoToken: undefined })
    toast('墨墨 Token 保存失败，请检查网络后重试')
  }
  saving.value = false
}
</script>

<template>
  <div class="card space-y-2">
    <div class="flex items-center gap-2">
      <div class="section-title !mb-0">墨墨背单词同步</div>
      <span
        class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        >云端同步</span
      >
    </div>
    <div class="flex gap-2">
      <input
        v-model="maimemoToken"
        type="password"
        class="input"
        :placeholder="
          store.settings.maimemoConnected
            ? '已配置（输入新 Token 可覆盖）'
            : '墨墨开放 API Token（App：我的→更多设置→实验功能→开放 API）'
        "
      />
      <button class="btn-ghost shrink-0" :disabled="saving" @click="saveMaimemoToken">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
    <button class="btn-primary w-full" :disabled="syncing" @click="emit('sync')">
      {{ syncing ? '同步中…' : '同步墨墨今日背诵数据' }}
    </button>
    <p class="text-[10px] text-slate-400">公测接口：需在墨墨 App 内开启「自动同步」，且当日打开过 App 后数据才准确</p>
  </div>
</template>
