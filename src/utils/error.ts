/**
 * 从异常中提取可展示给用户的文案。
 *
 * 项目内所有 API 调用（src/api/client.ts / community.ts）抛出的都是带 message 的 Error，
 * 因此优先取 message；取不到时退回调用方给的兜底文案。
 * 本文件是所有异常的对外文案出口：网络层异常（浏览器 fetch 的英文 TypeError）都在这里本地化，
 * 调用方无需各自判断异常类型。
 */

/** 网络层故障的统一中文文案（浏览器 fetch 失败时 reject 的英文原文：Chrome「Failed to fetch」、
 *  Safari「Load failed」、Firefox「NetworkError when attempting to fetch resource.」） */
export const NETWORK_ERROR_MESSAGE = '网络连接失败，请检查网络后重试'

/**
 * 是否为网络层故障。各浏览器引擎的 fetch 网络失败统一 reject TypeError；
 * 超时与主动中止是 DOMException（TimeoutError / AbortError），不属于网络故障，不能归到这里。
 */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError
}

export function getErrorMessage(e: unknown, fallback: string): string {
  // 断网时 fetch reject 的是英文 TypeError，直接取 message 会把「Failed to fetch」原样 toast 给用户
  if (isNetworkError(e)) return NETWORK_ERROR_MESSAGE
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  if (typeof e === 'string' && e) return e
  return fallback
}
