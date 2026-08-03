/**
 * 墨墨背单词官方开放 API 对接（公测）。
 * 文档：https://open.maimemo.com/document
 * 认证：Authorization: Bearer <token>（App 内 我的→更多设置→实验功能→开放 API 获取）
 * 注意：公测接口需在 App 中开启「自动同步」，且当日打开过 App 初始化后数据才准确。
 *
 * CORS 策略：
 * - 桌面端（Electron）：走主进程 IPC 代理（net.fetch 不受浏览器 CORS 限制）
 * - 网页端（GitHub Pages）：直接 fetch 会因墨墨服务端无 ACAO 头被拦截，抛出明确提示
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

/** 检测是否在 Electron 桌面端环境（preload 注入了 maimemoAPI 桥接） */
function hasDesktopBridge(): boolean {
  return typeof window !== 'undefined' && !!(window as any).maimemoAPI?.available
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
 * - 桌面端：通过 IPC 走主进程 net.fetch 代理（绕过 CORS）
 * - 网页端：直接 fetch（会被 CORS 拦截时抛出明确提示引导用户使用桌面端）
 */
export async function fetchMaimemoToday(token: string): Promise<MaimemoToday> {
  // 桌面端：走主进程 IPC 代理，无 CORS 限制
  if (hasDesktopBridge()) {
    return (window as any).maimemoAPI.fetch(token)
  }

  // 网页端：直接 fetch（会触发 CORS → catch 里给出明确提示）
  try {
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
  } catch (e: any) {
    // 网页端 CORS 错误的特判：给出明确引导提示
    if (e?.message && (e.message.includes('Failed to fetch') || e.message.includes('CORS') || e.message.includes('blocked'))) {
      throw new Error('网页端无法直连墨墨 API（受浏览器 CORS 安全策略限制）。请下载桌面端应用后使用此功能。')
    }
    throw e
  }
}
