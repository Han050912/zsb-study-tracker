<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import SettingsSubjectManager from '../components/settings/SettingsSubjectManager.vue'
import SettingsAppearance from '../components/settings/SettingsAppearance.vue'
import SettingsQuotes from '../components/settings/SettingsQuotes.vue'
import SettingsDataSection from '../components/settings/SettingsDataSection.vue'

const store = useAppStore()
const s = computed(() => store.settings)

function update(key: string, value: any) {
  store.updateSettings({ [key]: value })
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
          ><input
            id="set-nickname"
            :value="s.userName"
            class="input"
            @change="update('userName', ($event.target as HTMLInputElement).value)"
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
