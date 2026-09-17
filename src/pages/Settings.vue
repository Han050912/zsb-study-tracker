<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { useToast } from '../composables/useToast'
import { getErrorMessage } from '../utils/error'
import { settingsApi } from '../api/settings'
import SettingsSubjectManager from '../components/settings/SettingsSubjectManager.vue'
import SettingsAppearance from '../components/settings/SettingsAppearance.vue'
import SettingsQuotes from '../components/settings/SettingsQuotes.vue'
import SettingsDataSection from '../components/settings/SettingsDataSection.vue'

const store = useAppStore()
const toast = useToast()
const s = computed(() => store.settings)

function update(key: string, value: any) {
  store.updateSettings({ [key]: value })
}

/**
 * 昵称：输入内容先留在本地草稿，写入 staging/outbox **之前**必须过服务端唯一校验入口
 * （与「编辑资料」弹窗同口径）。超长 / 含敏感词的整行 settings 一旦进 outbox，
 * 会让之后每一次推送都被服务端整批 400 拒绝——全账号静默停止同步。
 * 校验失败时本地不生效并回显云端真值，避免用户误以为已保存。
 */
const userName = ref(store.settings.userName)
watch(
  () => store.settings.userName,
  (v) => {
    userName.value = v
  }
)
const savingUserName = ref(false)
async function saveUserName() {
  const name = userName.value.trim()
  if (!name) {
    toast('昵称不能为空')
    userName.value = s.value.userName
    return
  }
  if (name === s.value.userName || savingUserName.value) return
  savingUserName.value = true
  try {
    const validated = await settingsApi.validate({ userName: name, bio: s.value.bio })
    store.updateSettings({ userName: validated.userName })
    toast('昵称已更新')
  } catch (e) {
    userName.value = s.value.userName
    toast(getErrorMessage(e, '昵称修改失败，请重试'))
  } finally {
    savingUserName.value = false
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
    <h1 class="page-title">设置</h1>

    <!-- 基本信息 -->
    <div class="card space-y-3">
      <div class="section-title">基本信息</div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="set-nickname">昵称</label
          ><input id="set-nickname" v-model="userName" maxlength="30" class="input" @change="saveUserName" />
        </div>
        <div>
          <label class="label" for="set-exam-date">专升本考试日期</label
          ><input
            id="set-exam-date"
            type="date"
            :value="s.examDate"
            class="input"
            @change="update('examDate', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>

    <!-- 每日目标 -->
    <div class="card space-y-3">
      <div class="section-title">每日目标</div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="label" for="set-goal-minutes">学习时长（分钟）</label
          ><input
            id="set-goal-minutes"
            type="number"
            :value="s.dailyGoalMinutes"
            class="input"
            @change="update('dailyGoalMinutes', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div>
          <label class="label" for="set-goal-words">单词量</label
          ><input
            id="set-goal-words"
            type="number"
            :value="s.wordGoal"
            class="input"
            @change="update('wordGoal', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div>
          <label class="label" for="set-goal-problems">做题量</label
          ><input
            id="set-goal-problems"
            type="number"
            :value="s.problemGoal"
            class="input"
            @change="update('problemGoal', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
    </div>

    <SettingsSubjectManager />
    <SettingsAppearance />
    <SettingsQuotes />
    <SettingsDataSection />
  </div>
</template>
