/**
 * 墨墨背单词官方开放 API 对接（公测）。
 * 文档：https://open.maimemo.com/document
 * 认证：Authorization: Bearer <token>（App 内 我的→更多设置→实验功能→开放 API 获取）
 * 注意：公测接口需在 App 中开启「自动同步」，且当日打开过 App 初始化后数据才准确。
 */

const BASE = 'https://open.maimemo.com/open'

export interface MaimemoToday {
  newWords: number
  reviewWords: number
  finished: number
  total: number
}

interface TodayItem {
  voc_id: string
  is_new: boolean
  is_finished: boolean
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Token 无效或已过期，请重新获取')
  if (!res.ok) throw new Error(`墨墨接口请求失败（HTTP ${res.status}）`)
  // 墨墨响应外壳为 { success, data, errors }，真实业务数据在 data 字段内
  const wrapper = await res.json().catch(() => ({}))
  if (wrapper?.errors?.length || (wrapper?.error && wrapper.error.code)) {
    throw new Error(wrapper?.errors?.[0]?.message || wrapper?.error?.message || '墨墨接口返回错误')
  }
  return (wrapper?.data ?? {}) as T
}

/**
 * 拉取今日背诵数据：
 * - get_today_items 分新学/复习两次拉取（limit 1000 封顶），JS 侧按 is_finished 计数
 * - get_study_progress 补充今日总进度（失败时不影响主流程）
 */
export async function fetchMaimemoToday(token: string): Promise<MaimemoToday> {
  // 关键：必须带 is_finished:true，否则墨墨服务端返回空集（实测不带则 items=0）
  const [newRes, reviewRes] = await Promise.all([
    post<{ today_items?: TodayItem[] }>('/api/v1/memo/study/get_today_items', token, { is_finished: true, is_new: true, limit: 1000 }),
    post<{ today_items?: TodayItem[] }>('/api/v1/memo/study/get_today_items', token, { is_finished: true, is_new: false, limit: 1000 })
  ])
  const newWords = (newRes.today_items || []).filter(i => i.is_finished).length
  const reviewWords = (reviewRes.today_items || []).filter(i => i.is_finished).length

  let finished = newWords + reviewWords
  let total = 0
  try {
    const prog = await post<{ progress?: { finished: number; total: number } }>(
      '/api/v1/memo/study/get_study_progress', token, {})
    finished = prog.progress?.finished ?? finished
    total = prog.progress?.total ?? 0
  } catch { /* 进度接口失败不阻塞主数据 */ }

  return { newWords, reviewWords, finished, total }
}
