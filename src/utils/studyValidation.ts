/** 表单与 store 共用校验，空输入不能被 Number('') 转成有效的 0。 */
export function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function studyMinutesError(minutes: unknown): string | null {
  return validNumber(minutes) && minutes > 0 && minutes <= 1440 ? null : '时长需大于 0 且不超过 1440 分钟'
}

export function readingError(wpm: unknown, accuracy: unknown): string | null {
  if (!validNumber(wpm) || wpm <= 0) return '请填写大于 0 的阅读速度'
  if (!validNumber(accuracy) || accuracy < 0 || accuracy > 100) return '正确率需在 0 到 100 之间'
  return null
}

export function vocabError(newWords: unknown, reviewWords: unknown): string | null {
  if (![newWords, reviewWords].every((n) => validNumber(n) && Number.isSafeInteger(n) && n >= 0))
    return '新学和复习词数需为非负整数'
  if ((newWords as number) + (reviewWords as number) <= 0) return '请填写本次新学或复习词数'
  return null
}

export function materialPagesError(totalPages: unknown, readPages: unknown): string | null {
  for (const [label, value] of [
    ['总页数', totalPages],
    ['已读页数', readPages]
  ] as const) {
    if (value !== undefined && (!validNumber(value) || !Number.isSafeInteger(value) || value < 0))
      return `${label}需为非负整数，可留空`
  }
  if (typeof totalPages === 'number' && typeof readPages === 'number' && readPages > totalPages)
    return '已读页数不能超过总页数'
  return null
}

export function habitValueError(type: string, value: unknown): string | null {
  if (type === 'time')
    return typeof value === 'string' && (!value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) ? null : '请选择有效时间'
  if (!validNumber(value) || value < 0) return '请填写有效的非负数量；填写 0 可清零'
  if (type === 'checkbox' && value !== 0 && value !== 1) return '打卡状态无效'
  if (type === 'count' && !Number.isSafeInteger(value)) return '次数需为非负整数'
  return null
}

export function examError(exam: {
  title: string
  score: unknown
  totalScore: unknown
  minutes: unknown
}): string | null {
  if (!exam.title.trim()) return '请填写试卷名称'
  if (!validNumber(exam.totalScore) || exam.totalScore <= 0) return '总分需大于 0'
  if (!validNumber(exam.score) || exam.score < 0 || exam.score > exam.totalScore) return '得分需在 0 到总分之间'
  return studyMinutesError(exam.minutes)
}
