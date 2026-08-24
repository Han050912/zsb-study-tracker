/**
 * 敏感词词表同步脚本（手动运行）。
 * 从开源词库拉取非政治类目 → 清洗去重 → 合并手工词 → 生成 src/data/lexicon.ts。
 * 运行：在 worker 目录下 npm run sync:lexicon
 * 网络策略：主用 jsdelivr CDN，失败回退 GitHub raw；全部失败仍用手工词生成。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 开源词库：konsheng/Sensitive-lexicon（MIT），只取非政治类文件
const SOURCES = [
  { file: '色情类型.txt', level: 'hard' },
  { file: '色情词库.txt', level: 'hard' },
  { file: '暴恐词库.txt', level: 'hard' },
  { file: '涉枪涉爆.txt', level: 'hard' },
  { file: '非法网址.txt', level: 'hard' },
  // 注：不含「广告类型.txt」——该源混杂政治词与泛化误伤词（网络/客服/招聘/淘宝等），
  // 且其中的赌博/违法/色情词已筛选补充到下方 MANUAL_HARD。
]

// 手工补充词（学习社区场景特定词 + 高置信度辱骂词，不来自开源库）
const MANUAL_HARD = [
  // 广告引流（明确诈骗/违法引流）
  '加微信', '微信群', 'qq群', '扫码领', '刷单', '兼职日结', '微商', '返利', '代购',
  // 作弊交易
  '代考', '代写', '包过班', '保过班', '不过退款', '卖答案', '出售答案', '考试作弊',
  // 赌博违法
  '博彩', '赌博', '买彩票', '网贷', '裸聊',
  // 赌博违法补充（从开源「广告类型.txt」筛选出的明确违规词，原误归 soft）
  '六合彩', '足球投注',
  // 违法交易/作弊补充（原误归 soft）
  '代开发票', '售肾', '刻章办', '套牌车', '替考试', '考中答案', '改卷内幕', '信用卡提现',
  '私家侦探', '私人侦探', '针孔摄象', '隐形耳机',
  // 色情补充（高置信度，未被色情词库覆盖者，原误归 soft）
  '包夜', '口暴', '吞精', '毒龙', '足交', '楼凤', '代孕妈妈', '代生孩子', '借腹生子',
  // 极端内容
  '完全自杀手册', '用刀横向切腹',
  // 严重辱骂（性辱骂/诅咒/强烈人格侮辱）
  '傻逼', '脑残', '废物点心', '去死吧', '滚出去',
  '草泥马', '草你妈', '操你妈', '你妈逼', '妈逼', '妈卖批',
  '婊子', '骚货', '荡妇', '贱人', '贱货', '妓女',
  '畜生', '禽兽', '杂种', '野种', '狗日的', '狗东西', '猪狗不如',
  '王八蛋', '混蛋', '混账', '龟儿子', '龟孙子', '贱种',
  '智障', '弱智', '二百五',
  '死全家', '不得好死', '断子绝孙', '去死', '滚蛋',
]

const MANUAL_SOFT = [
  // 软性引流 / 擦边
  '加好友', '私聊我', '加我好友', '有偿', '接单', '低价出售',
  // 边界辱骂（标记待审，不直接拒绝）
  '废物', '恶心', '垃圾', '白痴', '蠢货',
  // 轻度调侃（网络用语）
  '笨蛋', '傻瓜', '呆子', '蠢猪', '沙雕', '辣鸡', '憨批', '憨憨', '二货', '逗比',
  // 作弊暗示
  '包过', '保过', '答案分享', '考前押题', '内部资料',
]

// 与 sensitive.ts normalize 一致的去标点/去空白/小写（网址词需剥离 . / : 才能匹配归一化后的文本）
const STRIP_RE = /[\s\-_.*#@!?,，。！？~·、（）()【】[\]<>《》"'“”‘’:：;；|\\/+=￥$&^%\u200b-\u200f\ufeff\ufe0e\ufe0f]+/g

/** 归一化单个词（供词表入库用），与运行时 normalize 的标点剥离规则保持一致 */
function normalizeWord(w) {
  return w.toLowerCase().replace(STRIP_RE, '')
}

/** 清洗一批词：trim → 去空 → 去 # 注释 → 归一化 → 去空 → 剔除单字 → 去重 */
function clean(words) {
  const seen = new Set()
  const out = []
  for (const raw of words) {
    const line = String(raw).trim()
    if (!line || line.startsWith('#')) continue
    const n = normalizeWord(line)
    if (!n) continue
    // 剔除单字（长度 < 2 的中文词），避免误伤正常内容
    if (n.length < 2) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** 从 URL 拉取文本，失败返回 null */
async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** 对单个来源文件依次尝试多镜像 */
async function fetchSource(file) {
  const encoded = encodeURIComponent(file)
  const urls = [
    `https://cdn.jsdelivr.net/gh/konsheng/Sensitive-lexicon@main/Vocabulary/${encoded}`,
    `https://raw.githubusercontent.com/konsheng/Sensitive-lexicon/main/Vocabulary/${encoded}`,
  ]
  for (const u of urls) {
    const text = await fetchText(u)
    if (text !== null) return text
  }
  return null
}

async function main() {
  const hard = new Set(MANUAL_HARD)
  const soft = new Set(MANUAL_SOFT)

  for (const { file, level } of SOURCES) {
    const text = await fetchSource(file)
    if (text === null) {
      console.warn(`[sync-lexicon] 拉取失败，跳过：${file}`)
      continue
    }
    const words = clean(text.split('\n'))
    for (const w of words) {
      if (level === 'hard') hard.add(w)
      else soft.add(w)
    }
    console.log(`[sync-lexicon] ${file} → ${words.length} 词`)
  }

  // 分级互斥：hard 优先，soft 中剔除已在 hard 的词
  for (const w of hard) soft.delete(w)
  // 手工词分级优先：MANUAL_SOFT 强制 soft（覆盖开源词库误分级，如「白痴」被开源 hard 收录）
  for (const w of MANUAL_SOFT) { soft.add(w); hard.delete(w) }

  const hardArr = [...hard].sort()
  const softArr = [...soft].sort()

  // 生成 lexicon.ts
  const gen = (label, arr) =>
    `export const ${label}: string[] = [\n${arr.map((w) => `  '${w.replace(/'/g, "\\'")}',`).join('\n')}\n]\n`

  const content =
    `// 本文件由 scripts/sync-lexicon.mjs 生成，请勿手改。\n` +
    `// 重新生成：在 worker 目录运行 npm run sync:lexicon\n\n` +
    gen('HARD_WORDS', hardArr) +
    `\n` +
    gen('SOFT_WORDS', softArr)

  const outDir = resolve(__dirname, '../src/data')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'lexicon.ts'), content, 'utf8')

  console.log(`[sync-lexicon] 生成 lexicon.ts：HARD=${hardArr.length} SOFT=${softArr.length}`)
}

main().catch((e) => {
  console.error('[sync-lexicon] 执行失败', e)
  process.exit(1)
})
