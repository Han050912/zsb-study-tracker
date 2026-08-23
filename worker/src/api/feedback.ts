import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { assertClean } from './sensitive'
import { displayName, notifyStatement } from './community'
import { requireAdmin } from './admin'

/**
 * 意见反馈：提交后先落 D1（站内管理员后台查看），再尽力创建 GitHub issue 回写链接。
 * - GitHub 集成复用 release.ts 的服务端 GITHUB_TOKEN 代理模式，失败静默降级，不影响落库。
 * - 联系方式仅存 D1，绝不写入公开 issue。
 */

const nowSec = () => Math.floor(Date.now() / 1000)

const FEEDBACK_TYPES = ['feature', 'bug', 'experience', 'other'] as const
type FeedbackType = (typeof FEEDBACK_TYPES)[number]

const TYPE_LABEL: Record<FeedbackType, string> = {
  feature: '功能建议', bug: 'Bug报告', experience: '体验评价', other: '其他'
}

const CONTENT_MAX = 2000
const CONTACT_MAX = 100
const IMAGE_MAX = 3
const GH_REPO = 'Han050912/zsb-study-tracker'

/** 截图路径校验：/api/community/images/<16位hex> */
const isImagePath = (u: string) => /^\/api\/community\/images\/[a-f0-9]{16}$/.test(u)

interface FeedbackRow {
  id: string
  type: FeedbackType
  content: string
  contact: string
  image_urls: string
  github_issue_url: string | null
  status: string
  created_at: number
  user_name?: string
}

/** 容错解析截图列表：数据损坏时降级为空数组，不拖垮管理后台列表 */
function parseImageUrls(raw: string | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toFeedback(r: FeedbackRow) {
  return {
    id: r.id,
    type: r.type,
    content: r.content,
    contact: r.contact,
    imageUrls: parseImageUrls(r.image_urls),
    githubIssueUrl: r.github_issue_url ?? null,
    status: r.status,
    createdAt: r.created_at,
    userName: r.user_name
  }
}

/**
 * 尽力而为地创建 GitHub issue，复用 release.ts 的服务端 GITHUB_TOKEN 代理模式。
 * 未配置 token / 超时 / 非 2xx 均返回 null（静默降级，不影响反馈落库）。
 * 联系方式不进入 issue（公开仓库，仅存 D1）。
 */
async function createGitHubIssue(
  env: Env, type: FeedbackType, content: string, imageUrls: string[], userName: string
): Promise<string | null> {
  const token = env.GITHUB_TOKEN
  if (!token) return null
  const lines = [
    `**类型**：${TYPE_LABEL[type]}`,
    `**提交人**：${userName}`,
    `**提交时间**：${new Date(nowSec() * 1000).toISOString()}`,
    '',
    '**描述**',
    content
  ]
  if (imageUrls.length) {
    lines.push('', '**截图**')
    for (const u of imageUrls) lines.push(`![](${u})`)
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'zsb-study-api-worker'
      },
      body: JSON.stringify({
        // 标题折叠换行为空格：GitHub issue 标题不允许含换行（含换行会 422 静默失败）
        title: `[${TYPE_LABEL[type]}] ${content.slice(0, 30).replace(/\s+/g, ' ').trim()}`,
        body: lines.join('\n')
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      console.error(`[feedback] 创建 GitHub issue 失败: ${res.status}`)
      return null
    }
    const data = await res.json() as { html_url?: string }
    return data.html_url ?? null
  } catch (e) {
    console.error('[feedback] 创建 GitHub issue 异常', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function registerFeedbackRoutes() {
  // 提交反馈（登录用户）
  on('POST', '/api/feedback', true, async (ctx) => {
    rateLimit(ctx.request, 'feedback', 20)
    const b = await body<{ type?: unknown; content?: unknown; contact?: unknown; imageUrls?: unknown }>(ctx.request)

    const type = b?.type as FeedbackType
    if (!FEEDBACK_TYPES.includes(type)) throw new HttpError(400, '问题类型无效')

    const content = String(b?.content ?? '').trim()
    if (!content) throw new HttpError(400, '请填写反馈内容')
    if (content.length > CONTENT_MAX) throw new HttpError(400, `反馈内容最多 ${CONTENT_MAX} 字`)

    const contact = String(b?.contact ?? '').trim().slice(0, CONTACT_MAX)
    // 截图：仅接受本系统上传路径，去重，且必须属于当前用户（防串用他人图片），与社区发帖同一口径
    const rawImageUrls: unknown[] = Array.isArray(b?.imageUrls) ? b.imageUrls : []
    const imageUrls = [...new Set(rawImageUrls.filter((u): u is string => typeof u === 'string'))]
    if (imageUrls.length > IMAGE_MAX) throw new HttpError(400, `截图最多 ${IMAGE_MAX} 张`)
    if (imageUrls.length) {
      if (imageUrls.some(u => !isImagePath(u))) throw new HttpError(400, '截图路径无效')
      const ids = imageUrls.map(u => u.split('/').pop()!)
      const owned = await all<{ id: string }>(ctx.env,
        `SELECT id FROM community_uploads WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        ctx.userId, ...ids)
      if (owned.length !== new Set(ids).size) throw new HttpError(400, '截图不存在或已失效，请重新上传')
    }

    assertClean(content)
    if (contact) assertClean(contact)

    const id = uid()
    await run(ctx.env,
      'INSERT INTO feedback (id, user_id, type, content, contact, image_urls, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, ctx.userId, type, content, contact, JSON.stringify(imageUrls), 'pending', nowSec())

    // GitHub issue：尽力而为，失败不影响已落库的反馈（联系方式不进 issue）
    const userName = await displayName(ctx.env, ctx.userId)
    const issueUrl = await createGitHubIssue(ctx.env, type, content, imageUrls, userName)
    if (issueUrl) await run(ctx.env, 'UPDATE feedback SET github_issue_url = ? WHERE id = ?', issueUrl, id)

    return Response.json({ id }, { status: 201 })
  })

  // 管理员：反馈列表（?status=pending|resolved 可选筛选）
  on('GET', '/api/admin/feedback', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const status = new URL(ctx.request.url).searchParams.get('status')
    const filtered = status === 'pending' || status === 'resolved'
    const where = filtered ? 'WHERE f.status = ?' : ''
    const rows = await all<FeedbackRow>(ctx.env, `
      SELECT f.*, COALESCE(rs.user_name, u.username) AS user_name
      FROM feedback f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN user_settings rs ON rs.user_id = f.user_id
      ${where}
      ORDER BY f.created_at DESC
      LIMIT 100`, ...(filtered ? [status] : []))
    return Response.json({ feedbacks: rows.map(toFeedback) })
  })

  // 管理员：更新反馈状态（pending ↔ resolved）
  on('PUT', '/api/admin/feedback/:id', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const b = await body<{ status?: unknown }>(ctx.request)
    const status = b?.status
    if (status !== 'pending' && status !== 'resolved') throw new HttpError(400, '状态无效')
    const fb = await first<{ id: string; user_id: string; type: FeedbackType }>(ctx.env,
      'SELECT id, user_id, type FROM feedback WHERE id = ?', ctx.params.id)
    if (!fb) throw new HttpError(404, '反馈不存在')
    await run(ctx.env, 'UPDATE feedback SET status = ? WHERE id = ?', status, ctx.params.id)
    if (status === 'resolved') {
      await batch(ctx.env, [notifyStatement(ctx.env, {
        userId: fb.user_id, type: 'system',
        content: `你的「${TYPE_LABEL[fb.type]}」反馈已处理，感谢你的反馈`
      })])
    }
    return Response.json({ ok: true })
  })
}
