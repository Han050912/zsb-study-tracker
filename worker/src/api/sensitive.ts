import { HttpError } from '../db'

/**
 * 社区内容敏感词过滤（本地规则层，零成本）。
 * 分级：
 *  - HARD：明确违规（广告/作弊/违法/严重辱骂），命中即拒绝发布（400），不落地。
 *  - SOFT：疑似违规（软性引流/边界辱骂/作弊暗示），先发布但标记 is_flagged 待审，由管理员复核。
 * 归一化：全角转半角 + 小写 + 去除空白/间隔/零宽/变体符 + 常见谐音/拆字映射，防「加 微 信」「加威信」「sb」式绕过。
 * 匹配：线性子串扫描（学习社区词表规模下足够快，≤1000 字 + 数百词 <1ms），不引入额外依赖。
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
  '煞笔': '傻逼', '傻毕': '傻逼', '沙比': '傻逼', 'sb': '傻逼',
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

// ---------- 词表 ----------

const HARD_WORDS = [
  // 广告引流（明确）
  '加微信', '微信群', 'qq群', '扫码领', '刷单', '兼职日结', '微商', '返利', '代购',
  // 作弊交易
  '代考', '代写', '包过班', '保过班', '不过退款', '卖答案', '出售答案', '考试作弊',
  // 赌博违法
  '博彩', '赌博', '买彩票', '网贷', '裸聊',
  // 辱骂攻击（严重）
  '傻逼', '脑残', '废物点心', '去死吧', '滚出去',
]

const SOFT_WORDS = [
  // 软性引流 / 擦边
  '加好友', '私聊我', '加我好友', '有偿', '接单', '低价出售',
  // 边界辱骂（标记待审，不直接拒绝）
  '废物', '恶心', '垃圾', '白痴', '蠢货',
  // 作弊暗示
  '包过', '保过', '答案分享', '考前押题', '内部资料',
]

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
    hard: HARD_WORDS.some(w => t.includes(w)),
    soft: SOFT_WORDS.some(w => t.includes(w)),
  }
}

/** 硬违规即拒绝。供用户名/标签/圈子/组队/反馈等「无待审语义」的场景复用（软词在这些场景不拦截） */
export function assertClean(text: string) {
  if (moderate(text).hard) {
    throw new HttpError(400, '内容包含违规信息，请修改后再发布')
  }
}
