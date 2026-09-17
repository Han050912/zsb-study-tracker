<script setup lang="ts">
import { ref } from 'vue'
import { usersApi } from '../../api/community/users'
import { circlesApi } from '../../api/community/circles'
import { getErrorMessage } from '../../utils/error'
import type { CommunityCircle, UserLookupResult } from '../../types'
import Modal from '../Modal.vue'
import AppTabs from '../../shared/components/AppTabs.vue'
const emit = defineEmits<{ close: []; 'search-posts': [keyword: string] }>()
const mode = ref('posts'),
  keyword = ref(''),
  loading = ref(false),
  error = ref(''),
  searched = ref(false)
const user = ref<UserLookupResult | null>(null),
  circles = ref<CommunityCircle[]>([])
async function search() {
  if (!keyword.value.trim() || loading.value) return
  if (mode.value === 'posts') {
    emit('search-posts', keyword.value.trim())
    return
  }
  loading.value = true
  error.value = ''
  searched.value = false
  user.value = null
  circles.value = []
  try {
    if (mode.value === 'users') user.value = await usersApi.lookup(keyword.value.trim())
    else circles.value = (await circlesApi.circles()).circles.filter((c) => c.name.includes(keyword.value.trim()))
    searched.value = true
  } catch (e) {
    error.value = getErrorMessage(e, '搜索失败，请重试')
  } finally {
    loading.value = false
  }
}
</script>
<template>
  <Modal title="搜索社区" :show="true" @close="emit('close')"
    ><div class="collaboration-page space-y-4">
      <AppTabs
        id="community-search"
        v-model="mode"
        :items="[
          { value: 'posts', label: '帖子' },
          { value: 'users', label: '用户' },
          { value: 'circles', label: '圈子' }
        ]"
        label="搜索类型"
      />
      <div id="community-search-panel" role="tabpanel" :aria-labelledby="`community-search-tab-${mode}`">
        <form class="flex gap-2" @submit.prevent="search">
          <input
            v-model="keyword"
            class="input min-w-0"
            :aria-label="mode === 'users' ? '用户 ID' : '关键词'"
            :placeholder="mode === 'users' ? '输入用户 ID' : '搜索你关心的内容'"
            maxlength="100"
          /><button class="btn-primary" :disabled="loading">搜索</button>
        </form>
        <p v-if="error" role="status" class="text-sm mt-3 text-red-500">{{ error }}</p>
        <RouterLink
          v-if="user && mode === 'users'"
          :to="{ name: 'profile', params: { id: user.userId } }"
          class="block py-4"
          >{{ user.userName }} →</RouterLink
        ><template v-if="mode === 'circles'"
          ><RouterLink
            v-for="circle in circles"
            :key="circle.id"
            :to="{ name: 'circle-detail', params: { id: circle.id } }"
            class="block py-4"
            >{{ circle.name }} →</RouterLink
          >
          <p v-if="searched && !circles.length" class="text-sm py-4 text-slate-500">
            没有找到这个圈子，试试其他名称。
          </p></template
        >
      </div>
    </div></Modal
  >
</template>
