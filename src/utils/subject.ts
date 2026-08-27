/**
 * 科目展示文案工具：内置科目去 emoji 后 icon 为空字符串，
 * 拼接时需跳过空图标，避免「 高数」这类多余前导空格。
 */
export function subjectLabel(
  s?: { icon?: string | null; name?: string | null } | null,
  fallback = ''
): string {
  if (!s?.name) return fallback
  return s.icon ? `${s.icon} ${s.name}` : s.name
}
