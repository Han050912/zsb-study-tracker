import { computed, onBeforeUnmount, ref } from 'vue'
import { usePostStore } from '../../../stores/community'
import type { CommunityPost } from '../../../types'

/** 圈子、知识点与个人作品各自保留列表 ID，所有帖子内容共享同一实体。 */
export function usePostCollection() {
  const entities = usePostStore(),
    ids = ref<string[]>([]),
    generation = entities.generation
  let disposed = false
  onBeforeUnmount(() => {
    disposed = true
  })
  const posts = computed({
    get: () => ids.value.map((id) => entities.postsById[id]).filter(Boolean),
    set: (value: CommunityPost[]) => {
      if (disposed || generation !== entities.generation) return
      entities.upsert(value)
      ids.value = [...new Set(value.map((post) => post.id))]
    }
  })
  return { posts, entities }
}
