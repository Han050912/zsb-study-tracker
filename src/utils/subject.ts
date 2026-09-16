/**
 * 科目展示文案工具：icon 前缀仅用于 emoji（内置科目/旧数据）。
 * lucide 图标名不能作为文本前缀（会显示成「book-open 高数」这类裸标识符），
 * 纯文本场景一律跳过；SVG 图标由 SubjectIcon 组件负责渲染。
 */
export function subjectLabel(s?: { icon?: string | null; name?: string | null } | null, fallback = ''): string {
  if (!s?.name) return fallback
  return isEmojiIcon(s.icon) ? `${s.icon} ${s.name}` : s.name
}

/** 是否为可直接作为文本前缀的 emoji 图标（lucide 图标名为 ASCII 标识符，需排除） */
function isEmojiIcon(icon?: string | null): boolean {
  if (!icon) return false
  // lucide 图标名形如 kebab-case ASCII（book-open）；emoji/旧数据含非 ASCII 字符
  return /[\u0080-\uffff]/.test(icon)
}
