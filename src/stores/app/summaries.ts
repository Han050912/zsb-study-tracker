/**
 * app store 的 summaries 域模块（每日总结，summaries 键 = 日期）。
 * 按拆分计划（docs/superpowers/plans/2026-09-13-store-split.md Task 4），本域唯一 action saveSummary
 * 归入 settings.ts（与 updateSettings/updateQuotes/setAvatar 同组）；本文件保留为该域的模块位，当前无成员。
 * 若后续为 summaries 域新增 action，按 sync.ts 模式补 AppStoreThis 类型标注与 this-free 显式签名类型。
 */

export const summariesActions = {
}
