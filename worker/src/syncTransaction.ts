import type { Env } from './index'
import { all, first, HttpError } from './db'

const GUARD_DOMAIN = '__push__'
const MAX_ATTEMPTS = 3

/** Assemble multi-query aggregates only while their synchronized source state is unchanged. */
export async function withUserSnapshot<T>(env: Env, userId: string, read: () => Promise<T>): Promise<T> {
  const revision = async () =>
    Number(
      (
        await first<{ version: number }>(
          env,
          'SELECT version FROM sync_domain_versions WHERE user_id = ? AND domain = ?',
          userId,
          GUARD_DOMAIN
        )
      )?.version ?? 0
    )
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await revision()
    const result = await read()
    if (before === (await revision())) return result
  }
  throw new HttpError(409, '数据正在另一设备更新，请重试同步')
}

export function domainVersionStatement(env: Env, userId: string, domain: string, version: number) {
  return env.DB.prepare(
    `INSERT INTO sync_domain_versions (user_id, domain, version, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, domain) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`
  ).bind(userId, domain, version, Math.floor(Date.now() / 1000))
}

/**
 * Pre-read decisions and their writes must describe the same committed user state.
 * The first batch statement rejects a stale snapshot; D1 rolls back the entire batch.
 * A retry rebuilds every decision. The builder must not execute writes or external effects.
 * Other entry points that modify synchronized data must use this wrapper as well.
 */
export async function withUserTransaction<T>(
  env: Env,
  userId: string,
  build: (versions: Readonly<Record<string, number>>) => Promise<{
    statements: D1PreparedStatement[]
    value: T
    readResult?: (results: D1Result[]) => T
  }>
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await all<{ domain: string; version: number }>(
      env,
      'SELECT domain, version FROM sync_domain_versions WHERE user_id = ?',
      userId
    )
    const versions = Object.fromEntries(rows.map((row) => [row.domain, Number(row.version)]))
    const expected = versions[GUARD_DOMAIN] ?? 0
    const plan = await build(versions)
    const guard = env.DB.prepare(
      `INSERT INTO sync_domain_versions (user_id, domain, version, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, domain) DO UPDATE SET
         version = CASE WHEN sync_domain_versions.version = ? THEN excluded.version ELSE NULL END,
         updated_at = excluded.updated_at`
    ).bind(userId, GUARD_DOMAIN, expected + 1, Math.floor(Date.now() / 1000), expected)
    try {
      const results = await env.DB.batch([guard, ...plan.statements])
      return plan.readResult ? plan.readResult(results.slice(1)) : plan.value
    } catch (error) {
      // Do not retry arbitrary constraints, transport failures or partially observed responses.
      const message = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error)
      if (!message.includes('NOT NULL constraint failed: sync_domain_versions.version')) throw error
      if (attempt === MAX_ATTEMPTS - 1) throw new HttpError(409, '数据正在另一设备更新，请重试同步')
    }
  }
  throw new HttpError(409, '同步冲突，请重试')
}
