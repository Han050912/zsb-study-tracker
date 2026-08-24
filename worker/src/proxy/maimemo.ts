import type { Env } from '../index'
import { on } from '../router'
import { first, HttpError } from '../db'
import { decryptSecret } from '../crypto'

/**
 * 墨墨背单词开放 API 代理。
 * - Token 从当前用户的 user_settings.maimemo_token 读取，前端永不直连 open.maimemo.com
 * - 墨墨响应外壳为 { success, data, errors }，真实业务数据在 data 字段内
 */

const MAIMEMO_BASE = 'https://open.maimemo.com/open'

interface TodayItem {
  voc_id: string
  voc_spelling: string
  is_new: boolean
  is_finished: boolean
}

interface InterpretationItem {
  id: string
  interpretation: string
  status: string
}

async function maimemoToken(env: Env, userId: string): Promise<string> {
  const row = await first(env, 'SELECT maimemo_token FROM user_settings WHERE user_id = ?', userId)
  const stored = (row as any)?.maimemo_token
  if (!stored) throw new HttpError(400, '请先在设置中填写墨墨开放 API Token')
  const token = await decryptSecret(env, String(stored))
  if (!token) throw new HttpError(400, '墨墨 Token 配置异常，请重新填写')
  return token
}

function unwrap<T>(res: Response, wrapper: any): T {
  // 使用 403 而非 401，避免前端将墨墨 Token 失效误判为「用户登录过期」强制登出
  if (res.status === 401 || res.status === 403) throw new HttpError(403, '墨墨 Token 无效或已过期，请重新获取')
  if (!res.ok) throw new HttpError(502, `墨墨接口请求失败（HTTP ${res.status}）`)
  if (wrapper?.errors?.length || wrapper?.error?.code) {
    throw new HttpError(502, wrapper?.errors?.[0]?.message || wrapper?.error?.message || '墨墨接口返回错误')
  }
  return (wrapper?.data ?? {}) as T
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${MAIMEMO_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
  return unwrap<T>(res, await res.json().catch(() => ({})))
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${MAIMEMO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return unwrap<T>(res, await res.json().catch(() => ({})))
}

/** 并发池：限制同时发出的释义请求数，避免触发墨墨频控（10s/20次） */
async function pool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++
        results[i] = await fn(items[i])
      }
    })
  )
  return results
}

/**
 * 有道词典网页端词典接口：英译汉（简明词典 ec）。
 * 旧 fanyi.youdao.com/translate 接口已停用（302 跳转错误页），
 * 此处使用 dict.youdao.com 的 jsonapi，返回带词性的多义项中文释义。
 * 仅作为墨墨 UGC 释义为空时的回退。
 */
async function fetchYoudaoMeaning(word: string): Promise<string> {
  try {
    const dicts = encodeURIComponent(JSON.stringify({ count: 99, dicts: [['ec']] }))
    const url = `https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&q=${encodeURIComponent(word)}&dicts=${dicts}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    if (!res.ok) return ''
    const data: any = await res.json()
    // 结构：ec.word[].trs[].tr[].l.i（i 可能是字符串或字符串数组）
    const parts: string[] = []
    for (const w of data?.ec?.word || []) {
      for (const tr of w.trs || []) {
        for (const t of tr.tr || []) {
          const i = t?.l?.i
          if (Array.isArray(i)) parts.push(...i.filter(Boolean))
          else if (typeof i === 'string' && i) parts.push(i)
        }
      }
    }
    return parts.join('；')
  } catch {
    return ''
  }
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

  // 今日单词明细（含拼写 + 释义）：新学 + 复习全部条目，按学习顺序排列
  on('POST', '/api/proxy/maimemo/today-detail', true, async (ctx) => {
    const token = await maimemoToken(ctx.env, ctx.userId)
    // 拉取全部今日条目（新学 + 复习），不按 is_finished 过滤，由前端展示完成状态
    const [newRes, reviewRes] = await Promise.all([
      post<{ today_items?: TodayItem[] }>('/api/v1/memo/study/get_today_items', token, { is_new: true, limit: 1000 }),
      post<{ today_items?: TodayItem[] }>('/api/v1/memo/study/get_today_items', token, { is_new: false, limit: 1000 })
    ])
    const items = [...(newRes.today_items || []), ...(reviewRes.today_items || [])]
    if (!items.length) return Response.json({ words: [] })

    // 批量拉取释义：并发 8 路，优先墨墨 UGC 释义，为空时回退有道词典
    const meanings = await pool(items, 8, async (item) => {
      // 主源：墨墨用户自建释义（UGC）
      try {
        const res = await get<{ interpretations?: InterpretationItem[] }>(
          `/api/v1/memo/interpretations?voc_id=${item.voc_id}`, token)
        const pub = (res.interpretations || []).find(i => i.status === 'PUBLISHED')
        if (pub?.interpretation) return pub.interpretation
      } catch { /* 降级到有道 */ }

      // 回退源：有道词典免费翻译（墨墨 API 不返回内置词典释义）
      return fetchYoudaoMeaning(item.voc_spelling)
    })

    return Response.json({
      words: items.map((item, i) => ({
        vocId: item.voc_id,
        spelling: item.voc_spelling,
        isNew: item.is_new,
        isFinished: item.is_finished,
        meaning: meanings[i]
      }))
    })
  })
}
