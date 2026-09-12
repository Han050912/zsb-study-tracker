import type { Env } from '../index'
import { on } from '../router'
import { all, uid } from '../db'

/**
 * 科目/章节/知识点三层结构：
 * - DB：subjects / chapters / topics 三张扁平表
 * - 前端：Subject 内嵌 chapters(topics 为名称数组) + mastery/topicImportance 以知识点名称为键
 */

export interface SubjectTree {
  id: string
  name: string
  icon: string
  color: string
  weight: number
  builtin: boolean
  chapters: { id: string; name: string; topics: string[] }[]
  mastery: Record<string, number>
  topicImportance: Record<string, string>
}

/** 拉取某用户全部科目并组装为前端树形结构 */
export async function getSubjectTree(env: Env, userId: string): Promise<SubjectTree[]> {
  // 按 rowid（即插入顺序）排序：无 ORDER BY 时 SQLite 不保证返回顺序，反复全量同步后章节/知识点顺序会漂移
  const subjects = await all(env, 'SELECT * FROM subjects WHERE user_id = ? ORDER BY rowid', userId)
  if (!subjects.length) return []
  const chapters = await all(env, 'SELECT * FROM chapters WHERE user_id = ? ORDER BY rowid', userId)
  const topics = await all(env, 'SELECT * FROM topics WHERE user_id = ? ORDER BY rowid', userId)

  const topicsByChapter = new Map<string, any[]>()
  for (const t of topics) {
    const list = topicsByChapter.get(t.chapter_id) ?? []
    list.push(t)
    topicsByChapter.set(t.chapter_id, list)
  }
  const chaptersBySubject = new Map<string, any[]>()
  for (const c of chapters) {
    const list = chaptersBySubject.get(c.subject_id) ?? []
    list.push(c)
    chaptersBySubject.set(c.subject_id, list)
  }

  return subjects.map((s: any) => {
    const mastery: Record<string, number> = {}
    const topicImportance: Record<string, string> = {}
    const treeChapters = (chaptersBySubject.get(s.id) ?? []).map((c: any) => {
      const topicRows = topicsByChapter.get(c.id) ?? []
      for (const t of topicRows) {
        mastery[t.name] = t.mastery ?? 0
        topicImportance[t.name] = t.importance ?? 'normal'
      }
      return { id: c.id, name: c.name, topics: topicRows.map((t: any) => t.name) }
    })
    return {
      id: s.id,
      name: s.name,
      icon: s.icon,
      color: s.color,
      weight: s.weight ?? 0,
      builtin: !!s.builtin,
      chapters: treeChapters,
      mastery,
      topicImportance
    }
  })
}

/**
 * 生成单个科目整树的写入语句（不含该科目子树的删除，调用方负责先清理）。
 *
 * - `stamp`（记录级同步传入）：科目主行走 `ON CONFLICT(user_id, id) DO UPDATE`
 *   —— 不能先删后插，否则每次推送都会换 rowid，同步后科目顺序漂移；
 *   同时给 chapters/topics 行写上同一份 `updated_at/server_seq`（子表行继承所属科目的值）。
 * - **保留客户端给出的 chapter id**（缺失才生成）；topic 在前端只有名称没有 id，
 *   故按「同章节内同名沿用既有 topic id」解析：否则每次整树重建都换新 uid，
 *   增量同步下客户端无法把同一知识点认作同一条记录（子树合并被破坏）。
 */
export async function subjectInsertStatements(
  env: Env,
  userId: string,
  s: SubjectTree,
  stamp?: { updatedAt: number; seq: number }
): Promise<D1PreparedStatement[]> {
  const stmts: D1PreparedStatement[] = []
  if (stamp) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO subjects (id, user_id, name, icon, color, weight, builtin, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, icon = excluded.icon, color = excluded.color, weight = excluded.weight, builtin = excluded.builtin, updated_at = excluded.updated_at, server_seq = excluded.server_seq'
      ).bind(s.id, userId, s.name, s.icon, s.color, s.weight ?? 0, s.builtin ? 1 : 0, stamp.updatedAt, stamp.seq)
    )
  } else {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO subjects (id, user_id, name, icon, color, weight, builtin) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(s.id, userId, s.name, s.icon, s.color, s.weight ?? 0, s.builtin ? 1 : 0)
    )
  }

  // 既有 topic（同章节同名）→ 沿用其 id
  const existing = await all<{ id: string; chapter_id: string; name: string }>(
    env,
    'SELECT id, chapter_id, name FROM topics WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE user_id = ? AND subject_id = ?)',
    userId,
    userId,
    s.id
  )
  const topicIds = new Map(existing.map((t) => [`${t.chapter_id}|${t.name}`, t.id]))

  for (const c of s.chapters ?? []) {
    const chapterId = c.id || uid()
    const mastery = (t: string) => s.mastery?.[t] ?? 0
    const importance = (t: string) => s.topicImportance?.[t] ?? 'normal'
    stmts.push(
      stamp
        ? env.DB.prepare(
            'INSERT INTO chapters (id, user_id, subject_id, name, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(chapterId, userId, s.id, c.name, stamp.updatedAt, stamp.seq)
        : env.DB.prepare('INSERT INTO chapters (id, user_id, subject_id, name) VALUES (?, ?, ?, ?)').bind(
            chapterId,
            userId,
            s.id,
            c.name
          )
    )
    for (const t of c.topics ?? []) {
      const topicId = topicIds.get(`${chapterId}|${t}`) ?? uid()
      stmts.push(
        stamp
          ? env.DB.prepare(
              'INSERT INTO topics (id, user_id, chapter_id, name, mastery, importance, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(topicId, userId, chapterId, t, mastery(t), importance(t), stamp.updatedAt, stamp.seq)
          : env.DB.prepare(
              'INSERT INTO topics (id, user_id, chapter_id, name, mastery, importance) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(topicId, userId, chapterId, t, mastery(t), importance(t))
      )
    }
  }
  return stmts
}

/** 删除单个科目的整棵子树（topics → chapters → subjects）；其学习记录等由调用方另行处理 */
export function subjectTreeDeleteStatements(env: Env, userId: string, subjectId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      'DELETE FROM topics WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE user_id = ? AND subject_id = ?)'
    ).bind(userId, userId, subjectId),
    env.DB.prepare('DELETE FROM chapters WHERE user_id = ? AND subject_id = ?').bind(userId, subjectId),
    env.DB.prepare('DELETE FROM subjects WHERE user_id = ? AND id = ?').bind(userId, subjectId)
  ]
}

export function registerSubjectRoutes() {
  on('GET', '/api/subjects', true, async (ctx) => {
    return Response.json(await getSubjectTree(ctx.env, ctx.userId))
  })
}
