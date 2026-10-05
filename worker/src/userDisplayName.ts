/** 默认昵称使用稳定的对外用户 ID，避免不同作者同名，也不暴露登录用户名。 */
export function defaultDisplayName(userCode: string | null | undefined, userId: string): string {
  let suffix = userCode || userId
  if (!userCode && userId.length > 26) {
    const hex = userId.replaceAll('-', '')
    if (/^[0-9a-f]{32}$/i.test(hex)) suffix = BigInt(`0x${hex}`).toString(36)
    else {
      let hash = 14695981039346656037n
      for (const char of userId) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n)
      suffix = hash.toString(36)
    }
  }
  return `升本人-${suffix}`
}

export function userDisplayName(name: unknown, userCode: string | null | undefined, userId: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed && trimmed !== '升本人' ? trimmed : defaultDisplayName(userCode, userId)
}
