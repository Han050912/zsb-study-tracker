import type { Env } from '../index'
import { on } from '../router'
import { first, HttpError } from '../db'

/**
 * 墨墨背单词开放 API 代理。
 * - Token 从当前用户的 user_settings.maimemo_token 读取，前端永不直连 open.maimemo.com
 * - 墨墨响应外壳为 { success, data, errors }，真实业务数据在 data 字段内
 */

const MAIMEMO_BASE = 'https://open.maimemo.com/open'

interface TodayItem {
  voc_id: string
  is_new: boolean
  is_finished: boolean
}

async function maimemoToken(env: Env, userId: string): Promise<string> {
  const row = await first(env, 'SELECT maimemo_token FROM user_settings WHERE user_id = ?', userId)
  const token = (row as any)?.maimemo_token
  if (!token) throw new HttpError(400, '请先在设置中填写墨墨开放 API Token')
  return token
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${MAIMEMO_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
  if (res.status === 401 || res.status === 403) throw new HttpError(401, '墨墨 Token 无效或已过期，请重新获取')
  if (!res.ok) throw new HttpError(502, `墨墨接口请求失败（HTTP ${res.status}）`)
  const wrapper: any = await res.json().catch(() => ({}))
  if (wrapper?.errors?.length || wrapper?.error?.code) {
    throw new HttpError(502, wrapper?.errors?.[0]?.message || wrapper?.error?.message || '墨墨接口返回错误')
  }
  return (wrapper?.data ?? {}) as T
}

export function registerMaimemoRoutes() {
  // 今日背诵数据：分别拉取新词/复习词的已完成条目计数
  on('POST', '/api/proxy/maimemo/today', true, async (ctx) => {
    const token = await maimemoToken(ctx.env, ctx.userId)
    const [newRes, reviewRes] = await Promise.all([
      post<{ today_items?: TodayItem[] }>('/api/v1/memo/study/get_today_items', token, { is_finished: true, is_new: true, limit: 1000 }),
      post<{ today_items?: TodayItem[] }>('/api/v1/memo/study/get_today_items', token, { is_finished: true, is_new: false, limit: 1000 })
    ])
    return Response.json({
      newWords: (newRes.today_items || []).filter(i => i.is_finished).length,
      reviewWords: (reviewRes.today_items || []).filter(i => i.is_finished).length
    })
  })

  // 学习进度：{ finished, total }
  on('GET', '/api/proxy/maimemo/progress', true, async (ctx) => {
    const token = await maimemoToken(ctx.env, ctx.userId)
    const prog = await post<{ progress?: { finished: number; total: number } }>(
      '/api/v1/memo/study/get_study_progress', token, {})
    return Response.json({
      finished: prog.progress?.finished ?? 0,
      total: prog.progress?.total ?? 0
    })
  })
}
