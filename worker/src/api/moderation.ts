import type { Env } from '../index'

/**
 * AI 语义复审模块（第二层内容安全，独立于本地词库 sensitive.ts）。
 *
 * 职责：本地 HARD/SOFT 词表未命中时，调用 Workers AI 文本模型做语义兜底，
 * 识别谐音、拆字、拼音缩写等本地词表覆盖不到的变形违规词。
 *
 * 关键约束：
 *  - fail-open：模型调用失败 / 超时 / 额度不足时，一律返回 none（不阻断发布），
 *    仅记录日志。AI 属「增强兜底」而非「必须闸门」，避免拖垮内容发布链路。
 *  - Token 不落地：CF_API_TOKEN 走 Cloudflare Secrets（生产）/ .dev.vars（本地），
 *    运行时经 env.CF_API_TOKEN 读取，前端与仓库均不暴露。
 */

/** AI 复审模型：llama-3.2-3b 为 3B 轻量非推理模型，响应快（~560ms）、省 token；
 *  中文识别略弱但足以覆盖常见谐音/拆字（如「代kao」），优先「快 + 省」。 */
const AI_MODEL = '@cf/meta/llama-3.2-3b-instruct'

/** 单次模型调用超时（毫秒）。超出即 fail-open，避免拖慢发布 */
const AI_TIMEOUT_MS = 5000

/** 模型返回的分级：hard 高置信违规 / soft 低置信待审 / none 未违规 */
export type ModerationLevel = 'hard' | 'soft' | 'none'

interface AiModerationResult {
  level: ModerationLevel
}

interface AiRawResponse {
  result?: {
    // qwen3 系列返回 OpenAI Chat Completions 格式
    choices?: Array<{ message?: { content?: unknown } }>
  }
}

/**
 * 构造系统提示词：要求模型严格输出单行 JSON，
 * 便于稳定解析（对非 JSON / 缺字段一律容错为 none，fail-open）。
 */
function buildPrompt(text: string): string {
  return [
    '你是学习社区的内容安全审核助手。请判断用户提交的内容是否违规。',
    '违规类型包括：广告引流、代考代写作弊、赌博违法、人身攻击辱骂、色情低俗。',
    '特别注意中文谐音、拆字、拼音缩写等变形写法（如「加威信」「代kao」「卖da案」「sb」）。',
    '请只输出一行 JSON，不要输出任何其他文字，格式如下：',
    '{"violation":true,"level":"hard","category":"广告","reason":"命中的违规词或理由"}',
    '其中 level 取值：',
    '  "hard" 表示高置信度明确违规（广告/作弊/违法/严重辱骂），',
    '  "soft" 表示疑似违规或擦边（软性引流/边界辱骂），',
    '  "none" 表示正常内容（此时 violation 为 false）。',
    '待审核内容：',
    text,
  ].join('\n')
}

/**
 * 从模型原始返回中稳健地抽取结果 JSON 字符串。
 * 容错：响应可能被包裹在 markdown 代码块或夹杂前后文字，做宽松抽取；失败返回 null。
 */
function extractJson(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // 优先取第一个 { 到最后一个 } 之间的内容
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}

/** 将模型 JSON 输出解析为分级结果，任何异常均容错为 none（fail-open） */
function parseLevel(response: unknown): ModerationLevel {
  const json = extractJson(response)
  if (!json) return 'none'
  try {
    const obj = JSON.parse(json) as { violation?: unknown; level?: unknown }
    // 与 prompt 契约一致：模型显式判定 violation=false 时视为未违规
    if (obj.violation === false) return 'none'
    if (obj.level === 'hard' || obj.level === 'soft') return obj.level
    return 'none'
  } catch {
    return 'none'
  }
}

/**
 * 调用 Workers AI 文本模型做语义复审。
 * 返回 { level: 'hard' | 'soft' | 'none' }。
 * 未配置 Token / 空文本 / 调用失败 / 超时 / 解析失败，一律返回 none（fail-open）。
 */
export async function aiModerate(text: string, env: Env): Promise<AiModerationResult> {
  const trimmed = text.trim()
  // 空文本 / 纯空白不浪费额度
  if (!trimmed) return { level: 'none' }

  // 未配置 Token / 账户 ID 时跳过 AI（本地词库仍生效），保证本地/未配置环境可用
  const token = env.CF_API_TOKEN
  const accountId = env.CF_ACCOUNT_ID
  if (!token || !accountId) {
    // 显式打日志，避免「AI 没生效」时无法判断是缺 Token 还是缺账户 ID
    console.warn('[aiModerate] 跳过 AI 复审（仅本地词库生效）:', !token ? '缺少 CF_API_TOKEN' : '缺少 CF_ACCOUNT_ID')
    return { level: 'none' }
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${AI_MODEL}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: buildPrompt(trimmed) },
          { role: 'user', content: trimmed },
        ],
        // 非推理模型直接输出结论，256 token 足够，省额度
        max_tokens: 256,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error(`[aiModerate] AI 调用失败 status=${res.status}`, await res.text().catch(() => ''))
      return { level: 'none' }
    }

    const data = (await res.json()) as AiRawResponse
    const level = parseLevel(data?.result?.choices?.[0]?.message?.content)
    if (level !== 'none') console.info('[aiModerate] AI 复审命中违规:', level)
    return { level }
  } catch (e) {
    console.error('[aiModerate] AI 调用异常（fail-open）', e)
    return { level: 'none' }
  } finally {
    clearTimeout(timer)
  }
}
