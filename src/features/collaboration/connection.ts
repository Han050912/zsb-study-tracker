export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline'
/** 后台保持低频心跳；失败指数退避，最多一分钟。 */
export function pollingDelay(failures: number, hidden: boolean): number {
  return Math.min(60_000, (hidden ? 30_000 : 10_000) * 2 ** Math.min(failures, 3))
}
