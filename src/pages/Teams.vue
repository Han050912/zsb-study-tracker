<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- 头部 -->
    <div class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="max-w-4xl mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">组队挑战</h1>
            <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">和小伙伴一起坚持学习，达标获徽章</p>
          </div>
          <button
            @click="openCreate"
            class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            创建小组
          </button>
        </div>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="max-w-4xl mx-auto px-4 py-4">
      <div class="flex space-x-4 border-b border-gray-200 dark:border-gray-700">
        <button
          @click="switchTab('my')"
          :class="[
            'px-4 py-2 border-b-2 transition-colors',
            activeTab === 'my'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          ]"
        >
          我的小组
        </button>
        <button
          @click="switchTab('public')"
          :class="[
            'px-4 py-2 border-b-2 transition-colors',
            activeTab === 'public'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          ]"
        >
          公开小组
        </button>
      </div>
    </div>

    <!-- 小组列表 -->
    <div class="max-w-4xl mx-auto px-4 pb-8">
      <div v-if="loading" class="text-center py-12 text-gray-600 dark:text-gray-400">
        加载中...
      </div>
      <div v-else-if="teams.length === 0" class="text-center py-12 text-gray-600 dark:text-gray-400">
        {{ activeTab === 'my' ? '还未加入任何小组' : '暂无公开小组' }}
      </div>
      <div v-else class="space-y-4">
        <div
          v-for="team in teams"
          :key="team.id"
          @click="openTeam(team.id)"
          class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 transition-shadow cursor-pointer hover:shadow-md"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center space-x-2">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ team.name }}</h3>
                <span
                  v-if="team.myRole === 'leader'"
                  class="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs rounded"
                >
                  队长
                </span>
                <span
                  v-else-if="team.myRole === 'member'"
                  class="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs rounded"
                >
                  成员
                </span>
              </div>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">{{ team.description || '暂无描述' }}</p>
              <div class="flex items-center space-x-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                <span>👥 {{ team.memberCount }}/{{ team.maxMembers }} 人</span>
                <span>{{ team.isPublic ? '🌐 公开' : '🔒 私密' }}</span>
                <span>{{ formatDate(team.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建小组对话框 -->
    <Modal :show="showCreateDialog" title="创建学习小组" @close="showCreateDialog = false">
      <form @submit.prevent="handleCreate">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                小组名称 <span class="text-red-500">*</span>
              </label>
              <input
                v-model="form.name"
                type="text"
                maxlength="30"
                required
                placeholder="1-30 字"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">小组描述</label>
              <textarea
                v-model="form.description"
                maxlength="200"
                rows="3"
                placeholder="0-200 字"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              ></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">最大人数</label>
              <input
                v-model.number="form.maxMembers"
                type="number"
                min="2"
                max="50"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div class="flex items-center">
              <input
                v-model="form.isPublic"
                type="checkbox"
                id="isPublic"
                class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label for="isPublic" class="ml-2 text-sm text-gray-700 dark:text-gray-300">
                公开小组（所有人可见可加入）
              </label>
            </div>
          </div>
          <div class="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              @click="showCreateDialog = false"
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="creating"
              class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {{ creating ? '创建中...' : '创建' }}
            </button>
          </div>
      </form>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, inject } from 'vue'
import { useRouter } from 'vue-router'
import { getTeams, createTeam } from '../api/teams'
import { isLoggedIn, requireLogin } from '../services/auth'
import type { StudyTeam } from '../types'
import Modal from '../components/Modal.vue'

const toast = inject<(m: string) => void>('toast', () => {})
const router = useRouter()

const activeTab = ref<'my' | 'public'>('my')
const loading = ref(false)
const teams = ref<StudyTeam[]>([])
const showCreateDialog = ref(false)
const creating = ref(false)

const form = ref({
  name: '',
  description: '',
  maxMembers: 10,
  isPublic: true
})

// 请求序号：快速切换 tab 时，旧请求的响应可能晚于新请求返回，
// 若不丢弃过期响应，会把「公开小组」数据覆盖到「我的小组」列表上
let loadSeq = 0

async function loadTeams() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const result = await getTeams(activeTab.value === 'my')
    if (seq === loadSeq) teams.value = result
  } catch (e: any) {
    if (seq === loadSeq) toast(e.message || '加载失败')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function switchTab(tab: 'my' | 'public') {
  if (activeTab.value === tab) return
  // 「我的小组」需登录：访客点击引导登录
  if (tab === 'my' && requireLogin(router)) return
  activeTab.value = tab
  loadTeams()
}

function openCreate() {
  if (requireLogin(router)) return
  showCreateDialog.value = true
}

async function handleCreate() {
  if (!form.value.name.trim()) {
    toast('请输入小组名称')
    return
  }

  creating.value = true
  try {
    await createTeam(form.value)
    toast('小组创建成功')
    showCreateDialog.value = false
    form.value = { name: '', description: '', maxMembers: 10, isPublic: true }
    // 新建后切到「我的小组」查看刚创建的小组
    activeTab.value = 'my'
    loadTeams()
  } catch (e: any) {
    toast(e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function openTeam(id: string) {
  // 小组详情接口需登录（含成员名单），访客点击引导登录
  if (requireLogin(router)) return
  router.push('/teams/' + id)
}

onMounted(() => {
  // 访客默认浏览公开小组；登录用户默认「我的小组」
  activeTab.value = isLoggedIn.value ? 'my' : 'public'
  loadTeams()
})
</script>
