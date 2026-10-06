import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** Check only an isolated empty SQLite database; never touches Wrangler or user data. */
export async function checkMigrationBaseline() {
  const root = new URL('../', import.meta.url)
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(await readFile(new URL('schema.sql', root), 'utf8'))
    db.exec(await readFile(new URL('schema-baseline.sql', root), 'utf8'))
    const names = (await readdir(new URL('migrations/', root))).filter((name) => name.endsWith('.sql')).sort()
    assert.deepEqual(
      db
        .prepare('SELECT name FROM d1_migrations ORDER BY name')
        .all()
        .map((row) => row.name),
      names,
      'schema-baseline.sql must register exactly the migrations included in the current schema snapshot'
    )
    for (const name of names) {
      const sql = await readFile(new URL(`migrations/${name}`, root), 'utf8')
      for (const match of sql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi)) {
        const [, table, column] = match
        assert.ok(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .some((row) => row.name === column),
          `${name}: schema snapshot lacks ${table}.${column}`
        )
      }
      for (const match of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
        assert.ok(
          db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(match[1]),
          `${name}: schema snapshot lacks index ${match[1]}`
        )
      }
    }
    return names.length
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`New database baseline verified: ${await checkMigrationBaseline()} migrations, no pending changes.`)
}
