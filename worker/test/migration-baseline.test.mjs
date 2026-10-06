import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { checkMigrationBaseline } from '../scripts/check-migration-baseline.mjs'

test('the fresh schema snapshot and migration baseline agree', async () => {
  await checkMigrationBaseline()
})

test('0011 preserves legacy totals and every historical event, repairs detail totals, and publishes a fresh cursor', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    const schema = (await readFile(new URL('../schema.sql', import.meta.url), 'utf8'))
      .replace(/ {2}legacy_(?:count|minutes|interruptions|updated_at) [^\r\n]+\r?\n/g, '')
      .replace(/, -- 服务端单调序号，拉取游标\r?\n {2}event_id TEXT/, ' -- 服务端单调序号，拉取游标')
      .replace(/CREATE UNIQUE INDEX IF NOT EXISTS idx_pomodoro_interruption_event[^;]+;/, '')
    db.exec(schema)
    db.exec(`INSERT INTO users(id,username,password_hash,created_at) VALUES ('u','legacy','unused',1);
      INSERT INTO pomodoro_daily(user_id,date,count,minutes,interruptions,server_seq) VALUES ('u','2026-10-04',3,75,2,4),('u','2026-10-05',1,25,2,4);
      INSERT INTO pomodoro_records(id,user_id,date,time,minutes,completed) VALUES ('a','u','2026-10-05',1,25,1),('b','u','2026-10-05',2,25,1),('c','u','2026-10-06',3,2,0);
      INSERT INTO pomodoro_interruptions(user_id,date,reason,time) VALUES ('u','2026-10-05','phone',1),('u','2026-10-05','phone',1);
      INSERT INTO sync_domain_versions(user_id,domain,version,updated_at) VALUES ('u','pomodoro',4,1),('u','__push__',10,1);`)
    db.exec(await readFile(new URL('../migrations/0011_data_integrity.sql', import.meta.url), 'utf8'))
    assert.deepEqual(
      db
        .prepare('SELECT date,count,minutes,interruptions,server_seq FROM pomodoro_daily ORDER BY date')
        .all()
        .map((row) => ({ ...row })),
      [
        { date: '2026-10-04', count: 3, minutes: 75, interruptions: 2, server_seq: 5 },
        { date: '2026-10-05', count: 2, minutes: 50, interruptions: 2, server_seq: 5 },
        { date: '2026-10-06', count: 0, minutes: 2, interruptions: 0, server_seq: 5 }
      ]
    )
    assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_records').get().n, 3)
    assert.equal(db.prepare('SELECT MIN(updated_at) stamp FROM pomodoro_daily').get().stamp, 1)
    assert.equal(db.prepare('SELECT MAX(legacy_updated_at) stamp FROM pomodoro_daily').get().stamp, 0)
    assert.deepEqual(
      db
        .prepare('SELECT id,event_id,reason,time FROM pomodoro_interruptions ORDER BY id')
        .all()
        .map((row) => ({ ...row })),
      [
        { id: 1, event_id: 'legacy:1', reason: 'phone', time: 1 },
        { id: 2, event_id: 'legacy:2', reason: 'phone', time: 1 }
      ]
    )
    assert.equal(db.prepare("SELECT version FROM sync_domain_versions WHERE domain='__push__'").get().version, 11)
  } finally {
    db.close()
  }
})
