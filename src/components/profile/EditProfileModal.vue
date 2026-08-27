<script setup lang="ts">
/** 编辑资料弹窗：头像 / 昵称 / 简介；昵称/简介走 PUT /api/settings（后端敏感词过滤），头像走独立上传接口 */
import { computed, inject, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import AvatarEditor from '../AvatarEditor.vue'
import { useAppStore } from '../../stores/app'
import { sessionUser } from '../../services/auth'
import { imageUrl } from '../../api/community'
import { settingsApi } from '../../api/settings'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean]; saved: [] }>()
const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const user = computed(() => sessionUser.value)

const userName = ref('')
const bio = ref('')
const showAvatarEditor = ref(false)

watch(() => props.show, v => {
  if (!v) return
  userName.value = store.settings.userName
  bio.value = store.settings.bio
})

function onAvatarUploaded(url: string) {
  store.settings.avatar = url
  store.save() // 上传端点服务端已写库，本地 save 保持全量同步口径一致
}

const saving = ref(false)
async function save() {
  const name = userName.value.trim()
  const bioText = bio.value.trim()
  if (!name) { toast('昵称不能为空'); return }
  if (saving.value) return
  saving.value = true
  try {
    // 走 PUT /api/settings：后端对 userName/bio 做敏感词过滤（命中 400 时抛错，message 透传）
    await settingsApi.update({ ...store.settings, userName: name, bio: bioText })
    // 已通过后端过滤并写库，直接更新本地（不走 updateSettings，避免触发冗余的全量 sync）
    store.settings.userName = name
    store.settings.bio = bioText
    toast('资料已保存')
    emit('saved')
    emit('update:show', false)
  } catch (e: any) {
    toast(e?.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :show="show" title="编辑资料" @close="emit('update:show', false)">
    <div class="space-y-5">
      <!-- 头像 -->
      <div class="flex items-center gap-4">
        <img v-if="store.settings.avatar" :src="imageUrl(store.settings.avatar)"
          class="w-16 h-16 rounded-2xl object-cover bg-slate-200 dark:bg-slate-700" alt="当前头像">
        <div v-else class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white flex items-center justify-center text-2xl font-bold select-none">
          {{ (userName || '升').trim().slice(0, 1).toUpperCase() }}
        </div>
        <div>
          <button class="btn-ghost !text-xs" type="button" @click="showAvatarEditor = true">更换头像</button>
          <p class="text-[11px] text-slate-400 mt-1.5">支持 JPG / PNG / WebP，将裁剪为正方形</p>
        </div>
      </div>

      <!-- 昵称 -->
      <div>
        <label class="block text-sm font-medium mb-1.5">昵称</label>
        <input v-model="userName" maxlength="30" class="input" placeholder="输入昵称">
        <p class="text-[11px] text-slate-400 mt-1">登录用户名：{{ user?.username }}（不可修改）</p>
      </div>

      <!-- 简介 -->
      <div>
        <label class="block text-sm font-medium mb-1.5">个人简介</label>
        <div class="relative">
          <textarea v-model="bio" maxlength="100" rows="3" class="input resize-none" placeholder="介绍一下自己吧"></textarea>
          <span class="absolute right-2 bottom-2 text-[11px] text-slate-400 pointer-events-none">{{ bio.length }}/100</span>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" type="button" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" type="button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
    </template>
  </Modal>
  <AvatarEditor v-model:show="showAvatarEditor" @uploaded="onAvatarUploaded" />
</template>
