import { defineStore } from 'pinia'
import { postsApi } from '../../api/community/posts'
import { usePostStore } from './entities'
import { getErrorMessage } from '../../utils/error'
import type { CommunityCircle, CommunityPost, RecommendUser } from '../../types'

export type FeedCategory = '' | 'recommend' | 'question' | 'featured' | 'follow'
export interface FeedQuery {
  sort: 'latest' | 'hot'
  tag: string
  category: FeedCategory
  keyword: string
}
export type AsyncStatus = 'idle' | 'initial-loading' | 'refreshing' | 'ready' | 'loading-more' | 'error'
interface FeedBucket {
  ids: string[]
  cursor: string | null
  hasMore: boolean
  status: AsyncStatus
  initialError: string
  loadMoreError: string
  updatedAt: number
  scrollY: number
  extras: { circles: CommunityCircle[]; users: RecommendUser[] } | null
}
const emptyBucket = (): FeedBucket => ({
  ids: [],
  cursor: null,
  hasMore: true,
  status: 'idle',
  initialError: '',
  loadMoreError: '',
  updatedAt: 0,
  scrollY: 0,
  extras: null
})
export const useCommunityFeedStore = defineStore('community-feed', {
  state: () => ({
    buckets: {} as Record<string, FeedBucket>,
    query: { sort: 'latest', tag: '', category: '', keyword: '' } as FeedQuery,
    ticket: 0
  }),
  getters: {
    key: (state) => JSON.stringify(state.query),
    bucket(): FeedBucket {
      return this.buckets[this.key] ?? emptyBucket()
    },
    posts(): CommunityPost[] {
      const entities = usePostStore()
      return this.bucket.ids.map((id) => entities.postsById[id]).filter(Boolean)
    },
    sort: (state) => state.query.sort,
    tag: (state) => state.query.tag,
    category: (state) => state.query.category,
    hasMore(): boolean {
      return this.bucket.hasMore
    },
    feedLoading(): boolean {
      return ['initial-loading', 'refreshing', 'loading-more'].includes(this.bucket.status)
    },
    error(): string {
      return this.bucket.initialError || this.bucket.loadMoreError
    },
    recommendExtras(): FeedBucket['extras'] {
      return this.bucket.extras
    }
  },
  actions: {
    resetState() {
      this.ticket++
      this.buckets = {}
      this.query = { sort: 'latest', tag: '', category: '', keyword: '' }
    },
    async select(query: FeedQuery) {
      this.query = query
      await this.fetchFeed(true)
    },
    async fetchFeed(reset = false) {
      const key = this.key,
        query = { ...this.query }
      if (!this.buckets[key]) this.buckets[key] = emptyBucket()
      const bucket = this.buckets[key]
      if (!reset && (!bucket.hasMore || this.feedLoading)) return
      const ticket = ++this.ticket
      bucket.status = reset ? (bucket.ids.length ? 'refreshing' : 'initial-loading') : 'loading-more'
      bucket.initialError = ''
      bucket.loadMoreError = ''
      try {
        const recommend = query.category === 'recommend' && !query.tag && !query.keyword && query.sort === 'latest'
        const res = recommend
          ? await postsApi.recommend()
          : await postsApi.feed({
              sort: query.sort,
              tag: query.tag || undefined,
              type: query.category === 'question' ? 'question' : undefined,
              featured: query.category === 'featured' || undefined,
              follow: query.category === 'follow' || undefined,
              keyword: query.keyword || undefined,
              cursor: reset ? null : bucket.cursor
            })
        if (ticket !== this.ticket) return
        usePostStore().upsert(res.posts)
        bucket.ids = [...new Set([...(reset ? [] : bucket.ids), ...res.posts.map((p) => p.id)])]
        bucket.cursor = 'nextCursor' in res ? res.nextCursor : null
        bucket.hasMore = !!bucket.cursor
        bucket.extras = 'circles' in res ? { circles: res.circles, users: res.users } : null
        bucket.updatedAt = Date.now()
        bucket.status = 'ready'
      } catch (e) {
        if (ticket !== this.ticket) return
        if (reset) bucket.initialError = getErrorMessage(e, '动态加载失败')
        else bucket.loadMoreError = getErrorMessage(e, '下一页加载失败')
        bucket.status = 'error'
      } finally {
        if (
          ticket !== this.ticket &&
          this.key !== key &&
          ['initial-loading', 'refreshing', 'loading-more'].includes(bucket.status)
        )
          bucket.status = bucket.ids.length ? 'ready' : 'idle'
      }
    }
  }
})
