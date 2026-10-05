<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useToast } from '../composables/useToast'
import { getErrorMessage } from '../utils/error'
import { settingsApi } from '../api/settings'
import SettingsSubjectManager from '../components/settings/SettingsSubjectManager.vue'
import SettingsAppearance from '../components/settings/SettingsAppearance.vue'
import SettingsQuotes from '../components/settings/SettingsQuotes.vue'
import SettingsDataSection from '../components/settings/SettingsDataSection.vue'
import { settingsGoalError, type GoalKey } from '../utils/settingsValidation'

const store = useAppStore()
const route = useRoute()
const toast = useToast()
const s = computed(() => store.settings)

// 首次打开时，设置内容会在账号数据加载完成后才挂载。
onMounted(() => {
  if (route.hash) document.getElementById(route.hash.slice(1))?.scrollIntoView()
})

function update(key: string, value: any) {
  store.updateSettings({ [key]: value })
}

function updateGoal(key: GoalKey, event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.value.trim() ? input.valueAsNumber : NaN
  const error = settingsGoalError(key, value)
  if (error) {
    input.value = String(s.value[key])
    toast(error)
    return
  }
  update(key, value)
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
  <div class="study-page settings-page">
    <header class="study-page-heading mb-6">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="mt-1 text-sm text-muted">调整学习目标、使用偏好与数据管理方式。</p>
      </div>
    </header>

    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分区">
        <RouterLink :to="{ name: 'settings', hash: '#settings-study' }">个人与学习</RouterLink>
        <RouterLink :to="{ name: 'settings', hash: '#settings-subjects' }">科目管理</RouterLink>
        <RouterLink :to="{ name: 'settings', hash: '#settings-preferences' }">外观与权限</RouterLink>
        <RouterLink :to="{ name: 'settings', hash: '#settings-data' }">数据与备份</RouterLink>
      </nav>
      <div class="settings-content">
        <section
          id="settings-study"
          class="settings-section card"
          :class="{ 'is-target': route.hash === '#settings-study' }"
          aria-labelledby="settings-study-title"
        >
          <!-- 基本信息 -->
          <h2 id="settings-study-title" class="section-title">个人与学习</h2>
          <p class="text-xs text-muted mb-4">修改后自动保存；昵称会先经过校验。</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="label" for="set-nickname">昵称</label
              ><input
                id="set-nickname"
                v-model="userName"
                maxlength="30"
                class="input"
                :disabled="savingUserName"
                :aria-busy="savingUserName"
                @change="saveUserName"
              />
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
          <div class="settings-goals">
            <h3 class="section-title">每日目标</h3>
            <p class="text-xs text-muted mb-3">设定每天计划完成的学习量。</p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="label" for="set-goal-minutes">学习时长（分钟）</label
                ><input
                  id="set-goal-minutes"
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  :value="s.dailyGoalMinutes"
                  class="input"
                  @change="updateGoal('dailyGoalMinutes', $event)"
                />
              </div>
              <div>
                <label class="label" for="set-goal-words">单词量</label
                ><input
                  id="set-goal-words"
                  type="number"
                  min="1"
                  step="1"
                  :value="s.wordGoal"
                  class="input"
                  @change="updateGoal('wordGoal', $event)"
                />
              </div>
              <div>
                <label class="label" for="set-goal-problems">做题量</label
                ><input
                  id="set-goal-problems"
                  type="number"
                  min="1"
                  step="1"
                  :value="s.problemGoal"
                  class="input"
                  @change="updateGoal('problemGoal', $event)"
                />
              </div>
            </div>
          </div>
        </section>

        <section
          id="settings-subjects"
          class="settings-section"
          :class="{ 'is-target': route.hash === '#settings-subjects' }"
          aria-label="科目管理"
        >
          <SettingsSubjectManager />
        </section>
        <section
          id="settings-preferences"
          class="settings-section space-y-4"
          :class="{ 'is-target': route.hash === '#settings-preferences' }"
          aria-label="外观与权限"
        >
          <SettingsAppearance />
          <SettingsQuotes />
        </section>
        <section
          id="settings-data"
          class="settings-section"
          :class="{ 'is-target': route.hash === '#settings-data' }"
          aria-label="数据与备份"
        >
          <SettingsDataSection />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  align-items: start;
  gap: 32px;
}
.settings-nav {
  position: sticky;
  top: calc(var(--app-header-height, 56px) + 20px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.settings-nav a {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: var(--radius-control);
  color: var(--muted);
  font-size: 14px;
}
.settings-nav a:hover {
  color: var(--action);
  background: var(--action-soft);
}
.settings-nav a:active {
  color: var(--action-active);
}
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.settings-section {
  scroll-margin-top: calc(var(--app-header-height, 56px) + 20px);
}
.settings-section.is-target {
  outline: 1px solid var(--action);
  outline-offset: 4px;
  border-radius: var(--radius-card);
}
.settings-goals {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  .settings-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .settings-nav a {
    padding-inline: 10px;
    color: var(--action);
  }
}
</style>
