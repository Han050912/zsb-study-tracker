/**
 * 规范化外部链接：补全协议头，兼容内网 / 外网各类链接格式。
 * - 已带协议（http/https/ftp）：原样保留；
 * - 协议相对地址（//host/path）：补 https:；
 * - 纯域名 / 主机名：默认补 https://；
 * - 内网 IP / localhost（可带端口）：默认补 http://。
 * 非法或不允许的协议（如 file:、javascript:）返回 null。
 */
export function normalizeUrl(raw?: string): string | null {
  if (!raw) return null
  const url = raw.trim()
  // URL 不允许出现空白字符（空格会导致跳转路径错乱）
  if (!url || /\s/.test(url)) return null

  let candidate = url
  if (candidate.startsWith('//')) {
    candidate = 'https:' + candidate
  } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    const host = candidate.split(/[/:?#]/)[0]
    const isLocal = /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i.test(host)
    candidate = (isLocal ? 'http://' : 'https://') + candidate
  }

  try {
    const u = new URL(candidate)
    if (!['http:', 'https:', 'ftp:'].includes(u.protocol)) return null
    return u.href
  } catch {
    return null
  }
}
