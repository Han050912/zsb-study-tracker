import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const code = await build({
  stdin: {
    contents: `export * from './worker/src/api/studyRewards'; export { gamificationProjectionStatement, getGamification } from './worker/src/api/gamification'; export { awardBadge } from './worker/src/api/badges'; import { registerChallengeRoutes } from './worker/src/api/teams/challenges'; export { route } from './worker/src/router'; registerChallengeRoutes();`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'local-auth',
      setup(builder) {
        builder.onResolve({ filter: /middleware\/(auth|rateLimit)$/ }, (args) => ({
          path: args.path,
          namespace: 'mock'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          contents: args.path.endsWith('auth')
            ? `export async function resolveAuth(request) { return { userId: request.headers.get('X-Test-User') || 'u', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
            : `export async function rateLimit() {}`
        }))
      }
    }
  ]
})
await mkdir(path.join(root, '.cache/reward-tests'), { recursive: true })
const file = path.join(root, `.cache/reward-tests/${crypto.randomUUID()}.mjs`)
await writeFile(file, code.outputFiles[0].text)
const api = await import(pathToFileURL(file).href)
await unlink(file)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
let db, env, beforeBatch
function statement(sql, args = []) {
  return {
    sql,
    args,
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
  }
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(schema)
  for (const id of ['u', 'peer'])
    db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,1)').run(id, id, 'unused')
  beforeBatch = null
  env = {
    DB: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => {
        beforeBatch?.()
        beforeBatch = null
        db.exec('BEGIN')
        try {
          const result = statements.map((s) => ({
            meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) }
          }))
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    }
  }
})
afterEach(() => db.close())
const change = (domain, key, operation = 'upsert') => ({ domain, key, operation })
async function reward(changes = [], points = []) {
  await env.DB.batch([
    ...api.studyRewardStatements(env, 'u', changes, points),
    api.gamificationProjectionStatement(env, 'u')
  ])
  return api.getGamification(env, 'u')
}
const points = () => db.prepare('SELECT COALESCE(SUM(points),0) AS n FROM points_log WHERE user_id=?').get('u').n

test('服务端从实际各域记录计算现有分值，不使用客户端金额', async () => {
  db.exec(`INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES ('r','u','math','${today()}',60,1);
    INSERT INTO problem_sessions(id,user_id,subject_id,date,total,correct,types) VALUES ('p','u','math','${today()}',23,20,'{}');
    INSERT INTO exam_records(id,user_id,subject_id,date,title,score,total_score,minutes) VALUES ('e','u','math','${today()}','exam',80,100,90);
    INSERT INTO error_questions(id,user_id,subject_id,date,type,content,review_count,created_at) VALUES ('q','u','math','${today()}','a','q',2,1);
    INSERT INTO vocab_records(id,user_id,date,new_words,review_words,points) VALUES ('v','u','${today()}',20,30,999999);
    INSERT INTO reading_records(id,user_id,date,wpm,accuracy) VALUES ('read','u','${today()}',100,0.8);
    INSERT INTO listening_records(id,user_id,date,minutes,material,mode) VALUES ('listen','u','${today()}',26,'book','精听');
    INSERT INTO todos(id,user_id,date,text,done) VALUES ('todo','u','${today()}','task',1);
    INSERT INTO habits(id,user_id,name,type,target,bad) VALUES ('h','u','read','minutes',10,0);
    INSERT INTO habit_records(user_id,habit_id,date,value) VALUES ('u','h','${today()}','10');
    INSERT INTO daily_summaries(user_id,date,mood,harvest,improve,plan) VALUES ('u','${today()}','ok','h','i','p');`)
  const changes = [
    change('records', 'r'),
    change('problemSessions', 'p'),
    change('exams', 'e'),
    change('errorQuestions', 'q'),
    change('english', 'vocab:v'),
    change('english', 'reading:read'),
    change('english', 'listening:listen'),
    change('todos', 'todo'),
    change('habits', 'h'),
    change('summaries', today())
  ]
  const result = await reward(changes, [{ op: 'award', reason: '学习 60 分钟', points: 999999, refId: 'free' }])
  assert.equal(result.points, 6 + 5 + 20 + 2 + 3 + 5 + 3 + 3 + 2 + 5)
  assert.ok(result.pointsLog.some((row) => row.refId === 'r' && row.points === 6))
  await reward(changes)
  assert.equal(points(), result.points)
})

test('任意奖励/撤销事件不修改账本；每日打卡只使用服务端当日键一次10分', async () => {
  db.prepare('INSERT INTO points_log(user_id,date,points,reason,ref_id) VALUES (?,?,?,?,?)').run(
    'u',
    today(),
    10,
    '回答被采纳',
    'srv:accept:c'
  )
  const forged = Array.from({ length: 100 }, (_, i) => ({
    op: 'award',
    refId: 'free' + i,
    reason: '每日打卡',
    points: 1000000,
    date: '2099-01-01'
  }))
  forged.push(
    { op: 'award', refId: 'fake', reason: '回答被采纳', points: 10 },
    { op: 'award', refId: 'missing', reason: '完成番茄钟', points: 5 },
    { op: 'revoke', all: true },
    { op: 'revoke', refPrefix: 'srv:' }
  )
  await reward([], forged)
  assert.equal(points(), 20)
  assert.equal(db.prepare('SELECT date FROM points_log WHERE ref_id=?').get('study:checkin:' + today()).date, today())
  await reward([], forged)
  assert.equal(points(), 20)
  assert.equal(db.prepare('SELECT count(*) AS n FROM points_log WHERE ref_id=?').get('srv:accept:c').n, 1)
})

test('旧奖励按自然键原位迁移，清除重复且保留原记账日期', async () => {
  db.exec(`INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES ('r','u','math','${today()}',30,1);
    INSERT INTO points_log(user_id,date,points,reason,ref_id) VALUES ('u','2026-01-01',3,'学习 30 分钟','r'),('u','2026-01-01',3,'学习 30 分钟','r');`)
  await reward([change('records', 'r')])
  const rows = db.prepare('SELECT date,points,ref_id FROM points_log').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].date, '2026-01-01')
  assert.equal(rows[0].points, 3)
  assert.equal(rows[0].ref_id, 'study:records:r')
  db.exec("DELETE FROM study_records WHERE id='r'")
  await reward([change('records', 'r', 'delete')])
  assert.equal(points(), 0)
})

test('取消待办/今日习惯按事实回收；历史习惯、坏习惯不补发奖励', async () => {
  db.exec(`INSERT INTO todos(id,user_id,date,text,done) VALUES ('t','u','${today()}','task',1);
    INSERT INTO habits(id,user_id,name,type,target,bad) VALUES ('h','u','habit','count',2,0),('bad','u','bad','count',1,1);
    INSERT INTO habit_records(user_id,habit_id,date,value) VALUES ('u','h','${today()}','2'),('u','h','2020-01-01','8'),('u','bad','${today()}','2');`)
  const changes = [change('todos', 't'), change('habits', 'h'), change('habits', 'bad')]
  await reward(changes)
  assert.equal(points(), 5)
  db.exec("UPDATE todos SET done=0; UPDATE habit_records SET value='1' WHERE habit_id='h'")
  await reward(changes)
  assert.equal(points(), 0)
})

test('完成番茄需要本账号实际记录；提前结束不计分，编辑与重放不重复', async () => {
  db.exec(
    `INSERT INTO pomodoro_records(id,user_id,date,time,minutes,completed) VALUES ('done','u','${today()}',1,25,1),('early','u','${today()}',1,2,0),('foreign','peer','${today()}',1,25,1);`
  )
  const changes = [change('pomodoro', 'rec:done'), change('pomodoro', 'rec:early')]
  await reward(changes)
  assert.equal(points(), 5)
  await reward(
    [],
    [
      { op: 'award', reason: '完成番茄钟', refId: 'done', points: 999 },
      { op: 'award', reason: '完成番茄钟', refId: 'early', points: 999 },
      { op: 'award', reason: '完成番茄钟', refId: 'foreign', points: 999 }
    ]
  )
  assert.equal(points(), 5)
  await reward(changes)
  assert.equal(points(), 5)
  db.exec("DELETE FROM pomodoro_records WHERE id='done'")
  await reward([change('pomodoro', 'rec:done', 'delete')])
  assert.equal(points(), 0)
})

test('旧番茄记录默认完成；将已奖励记录明确改为提前结束后回收奖且不返还额度', async () => {
  db.prepare('INSERT INTO pomodoro_records(id,user_id,date,time,minutes) VALUES (?,?,?,?,?)').run(
    'legacy',
    'u',
    today(),
    1,
    25
  )
  await reward([change('pomodoro', 'rec:legacy')])
  assert.equal(points(), 5)
  db.exec("UPDATE pomodoro_records SET completed=0 WHERE id='legacy'")
  await reward([change('pomodoro', 'rec:legacy')], [{ op: 'award', reason: '完成番茄钟', refId: 'legacy' }])
  assert.equal(points(), 0)
  assert.equal(db.prepare('SELECT spent FROM study_reward_daily_usage').get().spent, 5)
})

test('学习、打卡和服务端里程碑共用每日300额度，删除重建不返还，社区奖励不受限', async () => {
  for (const id of ['r1', 'r2', 'r3'])
    db.prepare(
      "INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES (?,'u','math',?,1440,1)"
    ).run(id, today())
  db.prepare('INSERT INTO points_log(user_id,date,points,reason,ref_id) VALUES (?,?,?,?,?)').run(
    'u',
    today(),
    1000,
    '获赞',
    'srv:like:community'
  )
  const changes = ['r1', 'r2', 'r3'].map((id) => change('records', id))
  await reward(changes, [{ op: 'award', reason: '每日打卡' }])
  await env.DB.batch([
    ...api.cappedStudyAwardStatements(env, 'u', [
      { refId: 'srv:streak:7', points: 5, reason: '连续学习满 7 天', date: '2099-01-01' }
    ]),
    api.gamificationProjectionStatement(env, 'u')
  ])
  assert.equal(points(), 1300)
  assert.equal(db.prepare('SELECT spent FROM study_reward_daily_usage').get().spent, 300)
  db.exec('DELETE FROM study_records')
  await reward(changes.map((item) => ({ ...item, operation: 'delete' })))
  assert.equal(points(), 1000)
  db.prepare(
    "INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES ('new','u','math',?,1440,1)"
  ).run(today())
  await reward([change('records', 'new')], [{ op: 'award', reason: '每日打卡' }])
  assert.equal(points(), 1000)
  assert.equal(db.prepare('SELECT spent FROM study_reward_daily_usage').get().spent, 300)
})

test('旧存量当天学习积分初始化额度，不清历史、不占用社区额度', async () => {
  db.prepare('INSERT INTO points_log(user_id,date,points,reason,ref_id) VALUES (?,?,?,?,?)').run(
    'u',
    today(),
    280,
    '学习 2800 分钟',
    'legacy'
  )
  db.prepare('INSERT INTO points_log(user_id,date,points,reason,ref_id) VALUES (?,?,?,?,?)').run(
    'u',
    today(),
    50,
    '评论帖子',
    'srv:c'
  )
  db.prepare(
    "INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES ('new','u','math',?,600,1)"
  ).run(today())
  await reward([change('records', 'new')])
  assert.equal(points(), 350)
  assert.equal(db.prepare("SELECT points FROM points_log WHERE ref_id='legacy'").get().points, 280)
  assert.equal(db.prepare("SELECT points FROM points_log WHERE ref_id='study:records:new'").get().points, 20)
})

test('额度和奖励同事务回滚，重试不消耗双份额度', async () => {
  db.exec("CREATE TRIGGER fail_reward BEFORE INSERT ON points_log BEGIN SELECT RAISE(ABORT,'fail reward'); END")
  await assert.rejects(reward([], [{ op: 'award', reason: '每日打卡' }]), /fail reward/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM study_reward_daily_usage').get().n, 0)
  db.exec('DROP TRIGGER fail_reward')
  await reward([], [{ op: 'award', reason: '每日打卡' }])
  assert.equal(db.prepare('SELECT spent FROM study_reward_daily_usage').get().spent, 10)
})

test('服务端跨日重置额度；旧日部分奖励重放不补旧日分数', async () => {
  const previousNow = Date.now
  try {
    Date.now = () => Date.parse('2026-09-27T15:59:59Z')
    for (const id of ['r1', 'r2', 'r3'])
      db.prepare(
        "INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES (?,'u','math',?,1440,1)"
      ).run(id, today())
    const changes = ['r1', 'r2', 'r3'].map((id) => change('records', id))
    await reward(changes)
    assert.equal(points(), 300)
    Date.now = () => Date.parse('2026-09-27T16:00:01Z')
    await reward(changes)
    assert.equal(points(), 300)
    await reward([], [{ op: 'award', reason: '每日打卡', date: '2026-09-27' }])
    assert.equal(points(), 310)
    assert.deepEqual(
      db
        .prepare('SELECT date,spent FROM study_reward_daily_usage ORDER BY date')
        .all()
        .map((row) => [row.date, row.spent]),
      [
        ['2026-09-27', 300],
        ['2026-09-28', 10]
      ]
    )
  } finally {
    Date.now = previousNow
  }
})

test('徽章构造无副作用；通知失败整体回滚，重试徽章/通知/广播各一次', async () => {
  const statements = await api.awardBadge(env, 'u', 'team_champion')
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_badges').get().n, 0)
  db.exec(
    "CREATE TRIGGER fail_notify BEFORE INSERT ON community_notifications BEGIN SELECT RAISE(ABORT,'fail notification'); END"
  )
  await assert.rejects(env.DB.batch(statements), /fail notification/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_badges').get().n, 0)
  db.exec('DROP TRIGGER fail_notify')
  await env.DB.batch(await api.awardBadge(env, 'u', 'team_champion'))
  await env.DB.batch(await api.awardBadge(env, 'u', 'team_champion'))
  for (const table of ['user_badges', 'community_notifications', 'community_posts'])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 1)
})

function seedTeam() {
  db.exec(`INSERT INTO study_teams(id,name,creator_id,member_count,created_at) VALUES ('team','team','u',2,1);
    INSERT INTO team_members(team_id,user_id,role,joined_at) VALUES ('team','u','leader',1),('team','peer','member',1);
    INSERT INTO team_challenges(id,team_id,type,target,duration_days,start_date,end_date,created_at) VALUES ('c','team','minutes',1,1,'${today()}','${today()}',1);
    INSERT INTO team_challenge_progress(challenge_id,user_id,is_completed,current_value) VALUES ('c','u',0,0),('c','peer',1,5);
    INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES ('r','u','math','${today()}',5,1);`)
}
const syncTeam = () =>
  api.route(new Request('http://local.invalid/api/teams/challenges/c/sync', { method: 'POST' }), env)
test('团队发奖任何步骤失败连同完成标记和进度回滚，重试全员到账', async () => {
  seedTeam()
  db.exec(
    "CREATE TRIGGER fail_peer BEFORE INSERT ON user_badges WHEN NEW.user_id='peer' BEGIN SELECT RAISE(ABORT,'fail peer'); END"
  )
  await assert.rejects(syncTeam(), /fail peer/)
  assert.equal(db.prepare('SELECT is_completed FROM team_challenges').get().is_completed, 0)
  assert.equal(db.prepare("SELECT current_value FROM team_challenge_progress WHERE user_id='u'").get().current_value, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_badges').get().n, 0)
  db.exec('DROP TRIGGER fail_peer')
  assert.equal((await syncTeam()).status, 200)
  assert.equal(db.prepare('SELECT is_completed FROM team_challenges').get().is_completed, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_badges').get().n, 2)
  const notices = db.prepare('SELECT count(*) AS n FROM community_notifications').get().n
  await syncTeam()
  assert.equal(db.prepare('SELECT count(*) AS n FROM community_notifications').get().n, notices)
})

test('团队读取后并发取消，不会发奖或置完成', async () => {
  seedTeam()
  beforeBatch = () => db.exec('UPDATE team_challenges SET is_cancelled=1')
  await syncTeam()
  assert.equal(db.prepare('SELECT is_completed FROM team_challenges').get().is_completed, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_badges').get().n, 0)
})

test('历史团队漏奖迁移幂等，补已有徽章的缺失效果，只奖励已完成参与者', async () => {
  seedTeam()
  db.exec(`UPDATE team_challenges SET is_completed=1;
    UPDATE team_challenge_progress SET is_completed=1;
    INSERT INTO users(id,username,password_hash,created_at) VALUES ('late','late','unused',1),('cancelled','cancelled','unused',1);
    INSERT INTO team_challenge_progress(challenge_id,user_id,is_completed) VALUES ('c','late',0);
    INSERT INTO team_challenges(id,team_id,type,target,duration_days,start_date,end_date,is_completed,is_cancelled,created_at)
      VALUES ('cancelled-c','team','minutes',1,1,'${today()}','${today()}',1,1,1);
    INSERT INTO team_challenge_progress(challenge_id,user_id,is_completed) VALUES ('cancelled-c','cancelled',1);
    INSERT INTO user_badges(user_id,badge_key,awarded_at) VALUES ('u','team_champion',1);
    INSERT INTO community_notifications(id,user_id,type,content,is_read,created_at)
      VALUES ('old-notice','peer','achievement','🎖️ 你获得了徽章「团队冠军」',1,1);
    INSERT INTO community_posts(id,user_id,type,content,tags,image_urls,ref_type,ref_id,created_at,updated_at)
      VALUES ('old-post','peer','achievement','old','[]','[]','badge','team_champion:peer',1,1);`)
  const migration = await readFile(
    new URL('../migrations/0004_repair_team_champion_awards.sql', import.meta.url),
    'utf8'
  )
  db.exec(migration)
  db.exec(migration)
  for (const table of ['user_badges', 'community_notifications', 'community_posts']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 2)
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id IN ('late','cancelled')`).get().n, 0)
  }
  assert.equal(db.prepare("SELECT awarded_at FROM user_badges WHERE user_id='u'").get().awarded_at, 1)
  assert.equal(db.prepare("SELECT is_read FROM community_notifications WHERE id='old-notice'").get().is_read, 1)
})
