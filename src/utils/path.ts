/**
 * 站内路径安全过滤：仅允许以单个 '/' 开头且不以 '//' 开头的站内相对路径，
 * 用于 from / redirect 等回跳参数的统一校验，集中防护开放重定向风险。
 * 合法返回原路径，非法返回 null。
 */
export function sanitizeInternalPath(p: unknown): string | null {
  if (typeof p !== 'string') return null
  if (!p.startsWith('/') || p.startsWith('//')) return null
  return p
}
