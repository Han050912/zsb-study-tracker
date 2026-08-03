/**
 * 刷题题型模板：按科目适配。
 * 数学沿用 选择/填空/计算/证明；英语替换为专属题型；其余自定义科目用通用题型。
 * 历史数据中的旧键名保留可查（PROBLEM_TYPE_LABELS 全量映射）。
 */
export interface ProblemTypeDef {
  key: string
  label: string
}

const MATH_TYPES: ProblemTypeDef[] = [
  { key: 'choice', label: '选择' },
  { key: 'blank', label: '填空' },
  { key: 'calc', label: '计算' },
  { key: 'proof', label: '证明' }
]

const ENGLISH_TYPES: ProblemTypeDef[] = [
  { key: 'choice', label: '单项选择' },
  { key: 'cloze', label: '完形填空' },
  { key: 'reading', label: '阅读理解' },
  { key: 'translate', label: '翻译' },
  { key: 'writing', label: '写作' }
]

const GENERIC_TYPES: ProblemTypeDef[] = [
  { key: 'choice', label: '选择' },
  { key: 'blank', label: '填空' },
  { key: 'short', label: '简答' },
  { key: 'other', label: '其他' }
]

/** 获取科目的题型模板 */
export function problemTypesFor(subjectId: string): ProblemTypeDef[] {
  if (subjectId === 'english') return ENGLISH_TYPES
  if (subjectId === 'math') return MATH_TYPES
  return GENERIC_TYPES
}

/** 题型键 -> 中文标签（覆盖所有历史键名，用于统计图例） */
export const PROBLEM_TYPE_LABELS: Record<string, string> = {
  choice: '选择题',
  blank: '填空题',
  calc: '计算题',
  proof: '证明题',
  cloze: '完形填空',
  reading: '阅读理解',
  translate: '翻译',
  writing: '写作',
  short: '简答题',
  other: '其他'
}
