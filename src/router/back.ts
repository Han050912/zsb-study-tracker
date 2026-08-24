/**
 * 路由回退配置：所有「返回」按钮的二级页兜底父级统一在此维护。
 * 键名必须与 router/index.ts 中的路由 name 严格一致。
 */

/** 各二级页无站内历史（直接访问 / 刷新 / 深链进入）时的兜底父级路由；键 = 路由 name */
export const BACK_FALLBACK: Record<string, string> = {
  'message-chat': '/messages',
  'community-post': '/community',
  'circle-detail': '/community/circles',
  'team-detail': '/teams',
  'profile': '/community',
  'topic-discussion': '/community',
  'follows': '/community',
  'circles': '/community',
  'partners': '/community',
  'feedback': '/settings',
  'admin': '/community',
}
