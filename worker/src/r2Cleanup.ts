import type { Env } from './index'
import { all, run } from './db'

// Keys queued here are immutable generations and are never reused by later uploads.
// The queue is committed with the reference removal, so an R2 failure remains retryable.
export async function cleanupR2Objects(env: Env): Promise<void> {
  const jobs = await all<{ r2_key: string }>(
    env,
    `SELECT r2_key FROM r2_cleanup_jobs j
     WHERE NOT EXISTS (SELECT 1 FROM error_images i WHERE i.r2_key = j.r2_key)
     ORDER BY created_at, r2_key LIMIT 100`
  )
  const failures: unknown[] = []
  for (const job of jobs) {
    try {
      await env.IMAGES.delete(job.r2_key)
      await run(env, 'DELETE FROM r2_cleanup_jobs WHERE r2_key = ?', job.r2_key)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new Error(`R2 cleanup failed for ${failures.length} object(s)`, { cause: failures[0] })
}
