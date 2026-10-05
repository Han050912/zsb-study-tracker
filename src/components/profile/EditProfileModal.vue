<script setup lang="ts">
/** 编辑资料弹窗：头像 / 昵称 / 简介；昵称/简介先走只读校验，持久化统一由记录同步负责。 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import Modal from '../Modal.vue'
import AvatarEditor from '../AvatarEditor.vue'
import { useAppStore } from '../../stores/app'
import { sessionUser } from '../../services/auth'
import { imageUrl } from '../../api/community'
import { settingsApi } from '../../api/settings'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean]; saved: [] }>()
const store = useAppStore()
const toast = useToast()

const user = computed(() => sessionUser.value)

const userName = ref('')
const bio = ref('')
const showAvatarEditor = ref(false)
const avatarRemoved = ref(false)
const previewAvatar = computed(() => (avatarRemoved.value ? '' : store.settings.avatar))
const saving = ref(false)
let editGeneration = 0

watch(
  () => [props.show, sessionUser.value?.id] as const,
  ([v]) => {
    editGeneration++
    saving.value = false
    avatarRemoved.value = false
    if (!v) {
      showAvatarEditor.value = false
      return
    }
    userName.value = store.settings.userName
    bio.value = store.settings.bio
  },
  { immediate: true, flush: 'sync' }
)
onUnmounted(() => {
  editGeneration++
})

function onAvatarUploaded(url: string) {
  avatarRemoved.value = false
  store.setAvatar(url)
  emit('saved')
}

function close() {
  if (saving.value) return
  emit('update:show', false)
}
async function save() {
  const name = userName.value.trim()
  const bioText = bio.value.trim()
  if (!name) {
    toast('昵称不能为空')
    return
  }
  if (saving.value) return
  const generation = editGeneration
  const owner = sessionUser.value
  const settings = store.settings
  const removeAvatar = avatarRemoved.value
  const isCurrent = () =>
    generation === editGeneration && props.show && sessionUser.value === owner && store.settings === settings
  saving.value = true
  try {
    const validated = await settingsApi.validate({ userName: name, bio: bioText })
    if (!isCurrent()) return
    store.updateSettings({ ...validated, ...(removeAvatar ? { avatar: '' } : {}) })
    toast('资料已保存')
    emit('saved')
    emit('update:show', false)
  } catch (e) {
    if (isCurrent()) toast(getErrorMessage(e, '保存失败，请重试'))
  } finally {
    if (generation === editGeneration) saving.value = false
  }
}
</script>

<template>
  <Modal :show="show" title="编辑资料" @close="close">
    <div class="space-y-5">
      <!-- 头像 -->
      <div class="flex items-center gap-4">
        <img
          v-if="previewAvatar"
          :src="imageUrl(previewAvatar)"
          class="w-16 h-16 rounded-2xl object-cover bg-slate-200 dark:bg-slate-700"
          alt="当前头像"
        />
        <div
          v-else
          class="w-16 h-16 rounded-2xl bg-action-soft text-action flex items-center justify-center text-2xl font-bold select-none"
        >
          {{ (userName || '升').trim().slice(0, 1).toUpperCase() }}
        </div>
        <div>
          <div class="flex flex-wrap gap-2">
            <button class="btn-ghost !text-xs" type="button" :disabled="saving" @click="showAvatarEditor = true">
              更换头像
            </button>
            <button
              v-if="previewAvatar"
              class="btn-ghost !text-xs"
              type="button"
              :disabled="saving"
              @click="avatarRemoved = true"
            >
              移除头像
            </button>
            <button
              v-else-if="avatarRemoved"
              class="btn-ghost !text-xs"
              type="button"
              :disabled="saving"
              @click="avatarRemoved = false"
            >
              撤销移除
            </button>
          </div>
          <p v-if="avatarRemoved" class="text-sm text-action mt-1.5" role="status">保存后将恢复字母头像。</p>
          <p class="text-xs text-slate-400 mt-1.5">支持 JPG / PNG / WebP，将裁剪为正方形</p>
        </div>
      </div>

      <!-- 昵称 -->
      <div>
        <label class="block text-sm font-medium mb-1.5" for="nickname">昵称</label>
        <input v-model="userName" id="nickname" maxlength="30" class="input" placeholder="输入昵称" />
        <p class="text-xs text-slate-400 mt-1">
          登录用户名：{{ user?.username }}（不可修改）· 密码请在「个人中心 → 账号安全」中修改
        </p>
      </div>

      <!-- 简介 -->
      <div>
        <label class="block text-sm font-medium mb-1.5" for="bio">个人简介</label>
        <div class="relative">
          <textarea
            v-model="bio"
            id="bio"
            maxlength="100"
            rows="3"
            class="input resize-none"
            placeholder="介绍一下自己吧"
          ></textarea>
          <span class="absolute right-2 bottom-2 text-xs text-slate-400 pointer-events-none">{{ bio.length }}/100</span>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" type="button" :disabled="saving" @click="close">取消</button>
      <button class="btn-primary" type="button" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
  <AvatarEditor v-model:show="showAvatarEditor" @uploaded="onAvatarUploaded" />
</template>
