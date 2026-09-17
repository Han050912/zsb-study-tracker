import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCommunityFeedStore } from '../../../stores/community'
import type { FeedCategory } from '../../../stores/community/feed-store'
import { isLoggedIn } from '../../../services/auth'

export function useFeedQuery() {
  const route = useRoute(),
    router = useRouter(),
    feed = useCommunityFeedStore()
  let mounted = false
  const view = computed(() => (typeof route.query.view === 'string' ? route.query.view : 'recommend'))
  const setQuery = (patch: Record<string, string | undefined>) =>
    router.push({ name: 'community', query: { ...route.query, ...patch } })
  watch(
    () => route.query,
    async () => {
      if (route.name !== 'community') return
      if (mounted && feed.buckets[feed.key]) feed.bucket.scrollY = window.scrollY
      mounted = true
      const requested = view.value
      const category: FeedCategory = ['recommend', 'question', 'featured', 'follow'].includes(requested)
        ? (requested as FeedCategory)
        : ''
      const pending = feed.select({
        category: !isLoggedIn.value && ['recommend', 'follow'].includes(category) ? '' : category,
        sort: route.query.sort === 'hot' ? 'hot' : 'latest',
        tag: typeof route.query.tag === 'string' ? route.query.tag : '',
        keyword: typeof route.query.q === 'string' ? route.query.q : ''
      })
      const key = feed.key
      await nextTick()
      if (feed.bucket.ids.length) window.scrollTo({ top: feed.bucket.scrollY })
      await pending
      if (feed.key === key) {
        await nextTick()
        window.scrollTo({ top: feed.bucket.scrollY })
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    if (feed.buckets[feed.key]) feed.bucket.scrollY = window.scrollY
    feed.ticket++
  })
  return { feed, view, setQuery }
}
