import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const workerDir = fileURLToPath(new URL('..', import.meta.url))

/** Local-only test fixture access; the explicit SQLite path avoids starting wrangler for each assertion. */
export function localD1(sql) {
  const filename = process.env.SMOKE_D1_SQLITE
  if (filename) {
    if (!existsSync(filename)) throw new Error(`SMOKE_D1_SQLITE does not exist: ${filename}`)
    const db = new DatabaseSync(filename)
    try {
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
      return JSON.stringify([{ results: db.prepare(sql).all() }])
    } finally {
      db.close()
    }
  }
  const args = [
    fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
    'd1',
    'execute',
    'zsb-study-db',
    '--local',
    '--json',
    '--command',
    sql
  ]
  if (process.env.SMOKE_D1_PERSIST_TO) args.push('--persist-to', process.env.SMOKE_D1_PERSIST_TO)
  return execFileSync(process.execPath, args, { cwd: workerDir }).toString()
}

// Preserve the existing Node 18 + wrangler path; direct SQLite requires Node 22.13+.
const DatabaseSync = process.env.SMOKE_D1_SQLITE ? (await import('node:sqlite')).DatabaseSync : null
