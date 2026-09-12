/**
 * Electron 安全策略纯判定模块
 *
 * 只回答「这个 URL 该怎么处理」，不产生任何副作用：真正的跳转/建窗/下载都由 main.cjs 执行。
 * 不依赖 Electron 运行时，因此可以直接用 node --test 覆盖全部判定分支。
 */
'use strict'

/** 允许交给系统默认浏览器打开的协议（与前端 src/utils/url.ts 的 normalizeUrl 白名单一致） */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'ftp:'])

/** 通知图标的远程来源 origin 白名单：生产仅应用自身数据源 */
const ICON_ORIGINS_PROD = new Set(['https://cn.zsbservice.de5.net'])
/** 开发环境额外允许本地 Worker（.env.development 的 VITE_API_BASE） */
const ICON_ORIGINS_DEV = new Set(['https://cn.zsbservice.de5.net', 'http://localhost:8787', 'http://127.0.0.1:8787'])

/** 头像资源路径：worker/src/api/uploads.ts 写入的唯一形态 */
const AVATAR_PATH_RE = /^\/api\/avatar\/[a-f0-9]{16}\.(?:png|jpg|webp)$/
/** data: 图片白名单（nativeImage 只接受图片，显式限定可避免无意义解析） */
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i

/** 安全解析 URL，非法输入返回 null */
function tryParseUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * 判定 window.open / target=_blank 的目标该如何处理。
 * @param {unknown} rawUrl 目标地址
 * @returns {'external'|'blob'|'deny'} external=交给系统浏览器；blob=应用内安全子窗口；deny=拒绝
 */
function classifyWindowOpen(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return 'deny'
  if (rawUrl.startsWith('blob:')) return 'blob'
  const url = tryParseUrl(rawUrl)
  if (!url) return 'deny'
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? 'external' : 'deny'
}

/** 是否为允许交给系统浏览器打开的绝对 URL */
function isAllowedExternalUrl(rawUrl) {
  const url = tryParseUrl(rawUrl)
  return !!url && EXTERNAL_PROTOCOLS.has(url.protocol)
}

/**
 * 是否为允许在应用窗口内导航的地址（应用自身内容）。
 * 用 origin 精确比较，避免 http://localhost:51730 这类前缀绕过。
 * @param {unknown} rawUrl 目标地址
 * @param {{ isDev?: boolean, devUrl?: string }} [opts]
 */
function isInternalAppUrl(rawUrl, opts = {}) {
  const url = tryParseUrl(rawUrl)
  if (!url) return false
  // blob: 只能由本应用渲染进程创建、origin 继承创建者，无法指向远程内容；资料页「打开已上传文件」
  // 依赖窗口加载 blob:（其首屏加载同样会触发 will-navigate），因此视为应用自身内容放行。
  if (url.protocol === 'blob:') return true
  if (url.protocol === 'app:') return opts.isDev !== true && url.host === 'localhost'
  if (opts.isDev !== true) return false
  const dev = tryParseUrl(opts.devUrl)
  return !!dev && url.origin === dev.origin
}

/**
 * 校验通知图标来源：只有应用自身头像资源（或 data:image）才允许交给主进程加载。
 * 目的是阻止渲染进程借主进程网络栈请求任意地址（SSRF / 隐私侧信道）。
 * @param {unknown} rawIcon 渲染进程传入的 icon
 * @param {{ isDev?: boolean }} [opts]
 * @returns {string|null} 可用地址；不合规返回 null（调用方回退系统默认图标）
 */
function resolveNotificationIconUrl(rawIcon, opts = {}) {
  if (typeof rawIcon !== 'string' || !rawIcon) return null
  if (rawIcon.startsWith('data:')) return DATA_IMAGE_RE.test(rawIcon) ? rawIcon : null
  const url = tryParseUrl(rawIcon)
  if (!url) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const allowed = opts.isDev === true ? ICON_ORIGINS_DEV : ICON_ORIGINS_PROD
  if (!allowed.has(url.origin)) return null
  if (!AVATAR_PATH_RE.test(url.pathname)) return null
  return url.href
}

module.exports = {
  EXTERNAL_PROTOCOLS,
  classifyWindowOpen,
  isAllowedExternalUrl,
  isInternalAppUrl,
  resolveNotificationIconUrl
}
