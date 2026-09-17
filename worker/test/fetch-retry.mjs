/**
 * 冒烟测试用的 fetch 包装：仅在「连接层瞬时故障」上做有界重试。
 *
 * 为什么只重试连接层错误：wrangler dev（workerd）会主动关闭空闲的 keep-alive 连接，而 Node 的 undici 要等到
 * 下次复用该连接时才发现它已死，于是抛出 read ECONNRESET —— 这是连接层抖动，与接口行为无关，重试即可通过。
 *
 * 为什么不重试 HTTP 状态码：401/404/429/500 都是服务端真实返回的业务结果，冒烟测试正是靠它们验证接口语义；
 * 一旦对状态码重试就会掩盖真实回归（例如本该 404 却被重试后的另一次响应变成 200）。因此只要 fetch 正常返回
 * 了 Response，无论什么状态码都原样返回，绝不重试。
 *
 * 已知取舍：理论上若首次请求已被服务端处理、仅响应在连接层丢失，重试会产生重复副作用。该场景必须同时满足
 * 「连接层失败」与「服务端已处理」两个条件，且重试上限仅 3 次，对本地冒烟测试（本地 D1/R2，可重复执行）
 * 可以接受；相比整轮 10-15 分钟因一次抖动全废，这是更优的取舍。
 */

/** 总尝试次数上限（即最多重试 2 次） */
const MAX_ATTEMPTS = 3

/** 退避基数：第 n 次尝试失败后等待 100ms * n，避免引入长等待 */
const RETRY_BASE_DELAY_MS = 100

/** 连接层瞬时故障的错误码（Node 系统错误与 undici 的错误码） */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  // undici 在「写入请求体时对端已断开」时抛 ECONNABORTED（dev server 重载 isolate 的典型表现），
  // 与 ECONNRESET 同属连接层抖动，重试即可恢复
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT'
])

/** 连接层瞬时故障在 message 中的特征串 */
const TRANSIENT_MESSAGE_HINTS = ['socket hang up', 'other side closed', ...TRANSIENT_CODES]

/**
 * 判断是否属于连接层瞬时故障。
 * Node 的 fetch 只会抛 `TypeError: fetch failed`，根因藏在 e.cause 里（cause.code / cause.errno / cause.message），
 * 因此必须同时检查自身与 cause 的 code、errno 和 message。
 */
function isTransientNetworkError(error) {
  const codes = [error?.code, error?.errno, error?.cause?.code, error?.cause?.errno]
  if (codes.some((code) => typeof code === 'string' && TRANSIENT_CODES.has(code))) return true
  const messages = [error?.message, error?.cause?.message].filter((message) => typeof message === 'string')
  return messages.some((message) => TRANSIENT_MESSAGE_HINTS.some((hint) => message.includes(hint)))
}

/** 取出用于告警的错误标识：优先错误码；无码（例如只有 message 命中「other side closed」）时回落 message 首段，避免日志打印 unknown */
function pickErrorCode(error) {
  const code = error?.code ?? error?.errno ?? error?.cause?.code ?? error?.cause?.errno
  if (typeof code === 'string' || typeof code === 'number') return String(code)
  const message = error?.cause?.message ?? error?.message
  return typeof message === 'string' && message ? message.slice(0, 40) : 'unknown'
}

/**
 * 带连接层有界重试的 fetch：仅瞬时连接故障重试（最多 3 次尝试），HTTP 状态码一律原样返回。
 * 重试时会打印告警，让抖动保持可见；重试用尽后抛出最后一次的原始错误，使整轮以清晰原因失败。
 */
export async function fetchRetry(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init)
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransientNetworkError(error)) throw error
      let path
      try {
        path = new URL(url).pathname
      } catch {
        path = String(url)
      }
      const delay = RETRY_BASE_DELAY_MS * attempt
      console.warn(
        `[fetchRetry] 连接层瞬时故障 ${pickErrorCode(error)}：${init?.method || 'GET'} ${path} ` +
          `第 ${attempt} 次尝试失败，${delay}ms 后重试`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
