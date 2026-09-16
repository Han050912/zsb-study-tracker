/**
 * 统一 fetch 封装：所有请求经 Cloudflare Worker。
 * - Web 端：会话存 HttpOnly Cookie（SameSite=None），请求带 credentials: 'include'，不接触明文 token
 * - 桌面端（Electron）：会话存 localStorage，请求带 Authorization Bearer + X-Desktop-Token
 * 401 时清除会话并跳转登录页——但登录/注册接口除外：这两类公开端点的 401
 * 表示凭证错误（账号不存在或密码错误），透传服务端消息给调用方展示。
 *
 * 请求策略（三者都在本模块实现，调用方无需关心）：
 * - 重试：GET 的瞬时故障（网络异常 / 5xx / 超时）指数退避重试，4xx 与有副作用的请求不重试
 * - 去重：同一 URL 的在飞 GET 复用同一个 Promise
 * - 并发闸门：单域名在飞请求数上限
 */
import { hasActiveSession, clearSession, desktopAuthHeaders, ensureDesktopToken } from '../utils/session'
import { isNetworkError } from '../utils/error'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787'

/** 带状态码的 API 错误：统一替代 `Object.assign(new Error(...), { status })` 样板 */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 公开凭证端点：其 401 不属于「会话过期」，不做全局登出处理 */
const CREDENTIAL_PATHS = ['/api/auth/login', '/api/auth/register']

const isDesktop = __DESKTOP_BUILD__

// ---------- 并发闸门 ----------

/**
 * 单域名同时在飞请求上限。全站请求都打向同一个 API_BASE，故一个全局计数即等价于单域名限流。
 * 取 6（与浏览器对单个源的连接数预算一致）：HTTP/2 下浏览器会为同一源开大量并发流，
 * 首屏 hydrate + 三路 30s 轮询 + 用户操作叠加时在飞请求数无上界，弱网下互相摊薄带宽、放大超时。
 * 闸门把并发收束为受控的 FIFO 队列，保证每个请求都拿到较充分的带宽。
 */
const MAX_CONCURRENT_REQUESTS = 6
let activeRequests = 0
const pendingSlots: Array<() => void> = []

/** 申请并发槽位：满额时排队等待；被释放时由 releaseSlot 直接把槽位转让给队首（不释放计数） */
async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++
    return
  }
  await new Promise<void>((resolve) => pendingSlots.push(resolve))
}

function releaseSlot(): void {
  const next = pendingSlots.shift()
  if (next) next()
  else activeRequests--
}

// ---------- 超时中止 ----------

/** 超时控制器：timedOut() 让调用方区分「超时」与「调用方主动中止」 */
interface TimeoutSignal {
  signal: AbortSignal
  timedOut: () => boolean
  cleanup: () => void
}

/**
 * 构造超时中止信号。优先用原生 AbortSignal.timeout；旧版 Safari(<16) / Android WebView 无此 API
 * （直接调用抛 TypeError「AbortSignal.timeout is not a function」会让全站请求失败），
 * 回退到 AbortController + setTimeout。
 * 兜底实现的 timedOut 只看控制器状态，不依赖 abort(reason) 在旧引擎上的支持。
 */
function createTimeoutSignal(timeoutMs: number): TimeoutSignal {
  if (typeof AbortSignal.timeout === 'function') {
    const signal = AbortSignal.timeout(timeoutMs)
    // 该信号仅因超时中止，aborted 即等价于超时；原生实现自行释放定时器，无需清理
    return { signal, timedOut: () => signal.aborted, cleanup: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.aborted,
    // 请求提前结束（成功/失败）时必须清掉定时器，避免遗留中止回调与定时器
    cleanup: () => clearTimeout(timer)
  }
}

/** 超时映射的状态码（沿用既有约定：由 authFetch 统一抛出，供 toast 展示） */
const TIMEOUT_STATUS = 408

/**
 * 单次请求：先占并发槽位（排队时间不计入超时），再带超时中断发出。
 * 超时统一抛 ApiError(408)，供上层判定为「瞬时故障」并重试。
 * 调用方自传 signal 时不做超时包装：其主动中止由调用方负责，不被误判为超时。
 */
async function fetchOnce(
  url: string,
  options: RequestInit,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  await acquireSlot()
  // 槽位申请成功后，下面任何一步抛异常都必须在 finally 里归还，否则 6 个槽位耗尽后全部请求永久排队
  let timeout: TimeoutSignal | null = null
  try {
    timeout = options.signal ? null : createTimeoutSignal(timeoutMs)
    const init: RequestInit = {
      ...options,
      headers,
      ...(isDesktop ? {} : { credentials: 'include' })
    }
    if (timeout) init.signal = timeout.signal
    return await fetch(url, init)
  } catch (e) {
    if (timeout?.timedOut()) throw new ApiError('请求超时，请重试', TIMEOUT_STATUS)
    throw e
  } finally {
    timeout?.cleanup()
    releaseSlot()
  }
}

// ---------- 重试 ----------

/**
 * GET 重试次数上限（首次 + 2 次重试）。弱网瞬断重试 1~2 次即可恢复；
 * 再多只会把失败反馈推迟给用户，并放大服务端瞬时故障时的压力。
 */
const GET_MAX_RETRIES = 2
/** 指数退避基数：第 n 次重试前等待 500 * 2^n ms（500ms → 1s） */
const RETRY_BASE_DELAY_MS = 500

/** 瞬时故障：网络层异常（fetch reject 的 TypeError）与超时（ApiError 408） */
function isTransientError(e: unknown): boolean {
  return isNetworkError(e) || (e instanceof ApiError && e.status === TIMEOUT_STATUS)
}

/** 退避等待（只在无调用方 signal 的重试路径上使用） */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 登录页路径（携带当前页面作为回跳地址）：会话过期跳转与主动跳登录（services/auth.ts 的 goLogin）
 * 共用同一条拼接逻辑，保证两种入口重新登录后都能回到原页面。
 */
export function loginRedirectPath(): string {
  const current = window.location.hash.replace(/^#/, '') || '/'
  return `/login?redirect=${encodeURIComponent(current)}`
}

/**
 * 会话失效的统一收尾：清理本地会话、通知应用清空内存中的用户数据、回登录页。
 * 供 401 全局处理与多标签页登出同步（services/auth.ts 的 storage 监听）复用。
 */
export function expireSession(): void {
  clearSession()
  window.dispatchEvent(new CustomEvent('auth:expired'))
  // 与 goLogin() 同一 redirect 逻辑：重新登录后回到原页面，不丢用户正在编辑的页面
  window.location.hash = `#${loginRedirectPath()}`
}

/** 401 全局处理：清除会话、通知清空内存数据、跳转登录页（导出供 XHR 上传等非 fetch 通道复用）。 */
export function handleUnauthorized(): never {
  // 以「本标签页是否仍持有登录态」判定，而不是只看跨标签页共享的持久化标记：
  // 多标签页下另一标签页登出会删除该标记，本标签页内存中的 currentUser 却仍在
  //（isLoggedIn 为 true、路由守卫放行），此时 401 若不处理会持续报错并停留在登录态界面
  const had = hasActiveSession()
  if (had) expireSession()
  // 曾登录（会话过期）与访客（未登录）的 401 语义不同，提示语区分，避免误导
  throw new ApiError(had ? '登录已过期，请重新登录' : '请先登录', 401)
}

/**
 * 携带认证凭据的原始 fetch：返回 Response 本身，供二进制上传/下载等非 JSON 场景使用。
 * 调用方自行检查 res.ok 并解析响应体；401 与 request() 走同一全局处理。
 */
export async function authFetch(
  path: string,
  options: RequestInit = {},
  baseHeaders: Record<string, string> = {},
  /** 默认 30s 超时，防止弱网下请求永久挂起；下载大文件等慢请求由调用方传更大的 timeoutMs */
  timeoutMs = 30_000
): Promise<Response> {
  // 桌面端先经 IPC 换取桌面令牌（幂等，命中内存缓存即返回），再附加认证头
  if (isDesktop) await ensureDesktopToken()
  const headers: Record<string, string> = {
    ...baseHeaders,
    ...((options.headers as Record<string, string>) || {})
  }
  // 桌面端附加认证头（X-Desktop-Token 无条件发送；Authorization 仅在 token 存在时）
  Object.assign(headers, desktopAuthHeaders())
  // 只重试幂等的 GET；调用方自传 signal（取消上传/下载）时同样不重试，避免把取消变成重复请求
  const isRetryable = (options.method ?? 'GET').toUpperCase() === 'GET' && !options.signal
  const maxRetries = isRetryable ? GET_MAX_RETRIES : 0
  const url = `${API_BASE}${path}`
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchOnce(url, options, headers, timeoutMs)
    } catch (e) {
      // 瞬时故障退避后重试；其余异常（调用方中止等）原样抛出——
      // 非 ApiError 的网络类异常由 src/utils/error.ts 的 getErrorMessage 单点本地化
      if (!isTransientError(e) || attempt >= maxRetries) throw e
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt)
      continue
    }
    if (res.status === 401 && !CREDENTIAL_PATHS.includes(path)) handleUnauthorized()
    // 5xx 视为服务端瞬时故障：未达重试上限则退避重试；4xx 是请求本身的问题，重试无意义
    if (res.status >= 500 && attempt < maxRetries) {
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt)
      continue
    }
    return res
  }
}

// ---------- 同 URL 去重 ----------

/**
 * 在飞 GET 的去重表：轮询与多组件同时拉取同一接口时复用同一个 Promise，避免请求叠加。
 * 去重放在解析 JSON 的 request() 层：authFetch 返回的 Response 体只能读一次，
 * 跨调用方共享需 clone 并缓冲整份响应体（大文件下载会内存翻倍），不值得。
 */
const inflightRequests = new Map<string, Promise<unknown>>()

/** 去重键：仅幂等 GET（含 query 的完整 path）；带 body 或非 GET 的请求有副作用，不参与去重 */
function dedupeKey(path: string, options: RequestInit): string | null {
  if (options.body || (options.method ?? 'GET').toUpperCase() !== 'GET') return null
  return `GET ${path}`
}

async function sendRequest<T>(path: string, options: RequestInit, timeoutMs?: number): Promise<T> {
  const res = await authFetch(path, options, { 'Content-Type': 'application/json' }, timeoutMs)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '请求失败' }))
    throw new ApiError(err.message || `HTTP ${res.status}`, res.status)
  }
  return res.json()
}

export function request<T>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const key = dedupeKey(path, options)
  if (!key) return sendRequest<T>(path, options, timeoutMs)
  const existing = inflightRequests.get(key)
  if (existing) return existing as Promise<T>
  // 条目在 Promise settle 时移除；期间不会插入新条目，故可直接按 key 删除
  const tracked = sendRequest<T>(path, options, timeoutMs).finally(() => inflightRequests.delete(key))
  inflightRequests.set(key, tracked)
  return tracked
}

/** Chrome keepalive 请求体上限（Firefox 更大，此处取 Chrome 保守值） */
const KEEPALIVE_MAX_BYTES = 60_000

/**
 * 页面卸载（beforeunload）时的兜底推送：keepalive 让请求在页面关闭后继续完成。
 * 当前用于按域同步的卸载兜底（单域载荷小，不会触发 keepalive 体积上限），不读取响应。
 */
export function requestKeepalive(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST'): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // 卸载兜底必须同步发出，无法 await IPC：桌面令牌由 session.ts 模块加载时预热进内存缓存
  Object.assign(headers, desktopAuthHeaders())
  const payload = JSON.stringify(body)
  if (payload.length > KEEPALIVE_MAX_BYTES) {
    console.warn(
      `keepalive 推送载荷 ${(payload.length / 1024).toFixed(1)}KB 超过安全上限，本次兜底推送将跳过（日常推送不走此路径，不影响数据完整性）`
    )
    return
  }
  fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: payload,
    keepalive: true,
    ...(isDesktop ? {} : { credentials: 'include' })
  }).catch(() => {
    /* 卸载兜底，失败无法重试 */
  })
}
