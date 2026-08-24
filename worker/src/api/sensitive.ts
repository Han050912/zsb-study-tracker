import { HttpError } from '../db'
import { aiModerate, type ModerationLevel } from './moderation'
import type { Env } from '../index'
import { AhoCorasick } from '../utils/ahoCorasick'
import { HARD_WORDS, SOFT_WORDS } from '../data/lexicon'

/**
 * 社区内容敏感词过滤（本地规则层，零成本）。
 * 分级：
 *  - HARD：明确违规（广告/作弊/违法/严重辱骂），命中即拒绝发布（400），不落地。
 *  - SOFT：疑似违规（软性引流/边界辱骂/作弊暗示），先发布但标记 is_flagged 待审，由管理员复核。
 * 归一化：全角转半角 + 小写 + 去除空白/间隔/零宽/变体符 + 常见谐音/拆字映射，防「加 微 信」「加威信」「sb」式绕过。
 * 匹配：Aho-Corasick 自动机（多模式匹配 O(n)，词表规模增大后仍高效）。
 */

// ---------- 归一化 ----------

/** 全角字符（FF01-FF5E）转半角（21-7E）；全角空格 U+3000 转半角空格 */
function toHalfWidth(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 0x3000) out += ' '
    else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCodePoint(c - 0xfee0)
    else out += ch
  }
  return out
}

/** 常见谐音/拆字/变体映射：把绕过写法归一为规范词，供词表命中 */
const HOMOPHONE_MAP: Record<string, string> = {
  '威信': '微信', '薇信': '微信', 'v信': '微信', 'vx': '微信',
  '企鹅': 'qq', '扣扣': 'qq',
  '煞笔': '傻逼', '傻毕': '傻逼', '沙比': '傻逼', '傻比': '傻逼', '煞比': '傻逼', 'sb': '傻逼',
  '草泥马': '操你妈', '草你妈': '操你妈', '草拟吗': '操你妈', '艹泥马': '操你妈', '草你马': '操你妈',
  '妈卖批': '妈逼',
  '制杖': '智障', '智帐': '智障',
  '脑惨': '脑残', 'nc': '脑残',
  '代kao': '代考', '代k': '代考',
  '卖da案': '卖答案', '卖da': '卖答案',
}

function normalize(s: string): string {
  let t = toHalfWidth(s).toLowerCase()
  // 去除空白、间隔符、零宽字符、变体选择符与常见标点/括号
  t = t.replace(/[\s\-_.*#@!?,，。！？~·、（）()【】[\]<>《》"'“”‘’:：;；|\\/+=￥$&^%\u200b-\u200f\ufeff\ufe0e\ufe0f]+/g, '')
  // 谐音归一：按 key 长度降序替换，避免短 key 提前吞掉长 key（如「vx」先于「v」）
  const keys = Object.keys(HOMOPHONE_MAP).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    // 纯英文缩写（sb/nc/vx）若用子串替换会误伤英文单词（since/USB/sync 等），
    // 仅按词边界（前后非字母）替换；中文谐音 key 无此风险，保持子串替换
    t = /^[a-z]+$/.test(k)
      ? t.replace(new RegExp(`\\b${k}\\b`, 'g'), HOMOPHONE_MAP[k])
      : t.split(k).join(HOMOPHONE_MAP[k])
  }
  return t
}

const hardAc = new AhoCorasick(HARD_WORDS)
const softAc = new AhoCorasick(SOFT_WORDS)

// ---------- 对外接口 ----------

export interface ModerationResult {
  /** 命中硬违规（拒绝发布） */
  hard: boolean
  /** 命中软违规（标记待审） */
  soft: boolean
}

/** 检测文本的软硬违规命中情况 */
export function moderate(text: string): ModerationResult {
  const t = normalize(text)
  return {
    hard: hardAc.containsAny(t),
    soft: softAc.containsAny(t),
  }
}

export interface AssertCleanOptions {
  /**
   * 是否允许 soft 违规降级为 flagged（而非直接拒绝）。
   * true：有「待审」语义的场景（帖子/评论），soft 返回 { flagged: true } 不拒绝；
   * false（默认）：无待审语义的场景（用户名/昵称/圈子/标签/专长/反馈/私信），soft 也直接拒绝。
   */
  allowSoft?: boolean
}

export interface AssertCleanAsyncResult {
  /** 是否命中 soft 违规、应标记 is_flagged 待审（仅 allowSoft=true 时可能为 true） */
  flagged: boolean
}

/**
 * 分层内容校验（异步）：
 *  1. 本地词库（同步、零成本）：hard 直接拒绝；soft 且 allowSoft 时降级 flagged，不调 AI。
 *  2. AI 语义复审（异步、兜底）：仅本地未命中时调用，识别谐音/拆字/拼音缩写等变形违规。
 *     AI hard → 拒绝；AI soft → allowSoft 降级 flagged / 否则拒绝；AI none → 放行。
 *     AI 调用失败/超时/未配置 Token 一律 fail-open 放行（本地词库仍生效）。
 */
export async function assertCleanAsync(
  text: string,
  env: Env,
  opts?: AssertCleanOptions
): Promise<AssertCleanAsyncResult> {
  const local = moderate(text)
  if (local.hard) {
    throw new HttpError(400, '内容包含违规信息，请修改后再发布')
  }
  if (local.soft) {
    if (opts?.allowSoft) return { flagged: true }
    throw new HttpError(400, '内容疑似包含违规信息，请修改后再发布')
  }

  const level: ModerationLevel = (await aiModerate(text, env)).level
  if (level === 'hard') {
    throw new HttpError(400, '内容包含违规信息，请修改后再发布')
  }
  if (level === 'soft') {
    if (opts?.allowSoft) return { flagged: true }
    throw new HttpError(400, '内容疑似包含违规信息，请修改后再发布')
  }
  return { flagged: false }
}
