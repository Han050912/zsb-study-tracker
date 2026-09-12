/**
 * 从异常中提取可展示给用户的文案。
 *
 * 项目内所有 API 调用（src/api/client.ts / community.ts）抛出的都是带 message 的 Error，
 * 因此优先取 message；取不到时退回调用方给的兜底文案。
 */
export function getErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  if (typeof e === 'string' && e) return e
  return fallback
}
