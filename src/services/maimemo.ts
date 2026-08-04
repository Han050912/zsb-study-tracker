/**
 * 墨墨背单词数据同步。
 * 网页端与桌面端统一经 Cloudflare Worker 代理（/api/proxy/maimemo/*），
 * Token 保存在用户设置中由 Worker 读取，前端不再直连 open.maimemo.com。
 * 注意：公测接口需在 App 中开启「自动同步」，且当日打开过 App 初始化后数据才准确。
 */
import { request } from '../api/client'

export interface MaimemoToday {
  newWords: number
  reviewWords: number
  finished: number
  total: number
}

/** 拉取今日背诵数据 + 学习进度（合并为一次调用） */
export async function fetchMaimemoToday(): Promise<MaimemoToday> {
  const [today, progress] = await Promise.all([
    request<{ newWords: number; reviewWords: number }>('/api/proxy/maimemo/today', { method: 'POST' }),
    request<{ finished: number; total: number }>('/api/proxy/maimemo/progress')
  ])
  return {
    newWords: today.newWords,
    reviewWords: today.reviewWords,
    finished: progress.finished,
    total: progress.total
  }
}
