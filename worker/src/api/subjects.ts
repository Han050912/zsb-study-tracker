import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, batch, uid, HttpError } from '../db'

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
  const subjects = await all(env, 'SELECT * FROM subjects WHERE user_id = ?', userId)
  if (!subjects.length) return []
  const chapters = await all(env, 'SELECT * FROM chapters WHERE user_id = ?', userId)
  const topics = await all(env, 'SELECT * FROM topics WHERE user_id = ?', userId)

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
      id: s.id, name: s.name, icon: s.icon, color: s.color,
      weight: s.weight ?? 0, builtin: !!s.builtin,
      chapters: treeChapters, mastery, topicImportance
    }
  })
}

/** 生成单个科目整树插入语句（不含删除，调用方负责先清理） */
export function subjectInsertStatements(env: Env, userId: string, s: SubjectTree): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('INSERT INTO subjects (id, user_id, name, icon, color, weight, builtin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, userId, s.name, s.icon, s.color, s.weight ?? 0, s.builtin ? 1 : 0)
  ]
  for (const c of s.chapters ?? []) {
    const chapterId = c.id || uid()
    stmts.push(
      env.DB.prepare('INSERT INTO chapters (id, user_id, subject_id, name) VALUES (?, ?, ?, ?)').bind(chapterId, userId, s.id, c.name)
    )
    for (const t of c.topics ?? []) {
      stmts.push(
        env.DB.prepare('INSERT INTO topics (id, user_id, chapter_id, name, mastery, importance) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(uid(), userId, chapterId, t, s.mastery?.[t] ?? 0, s.topicImportance?.[t] ?? 'normal')
      )
    }
  }
  return stmts
}

/** 生成某用户全部科目树的删除语句（子表先删） */
export function subjectDeleteStatements(env: Env, userId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM topics WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM chapters WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM subjects WHERE user_id = ?').bind(userId)
  ]
}

export function registerSubjectRoutes() {
  on('GET', '/api/subjects', true, async (ctx) => {
    return Response.json(await getSubjectTree(ctx.env, ctx.userId))
  })

  on('POST', '/api/subjects', true, async (ctx) => {
    const b = await body<SubjectTree>(ctx.request)
    if (!b?.name) throw new HttpError(400, '科目名称不能为空')
    const id = b.id || uid()
    await batch(ctx.env, subjectInsertStatements(ctx.env, ctx.userId, { ...b, id }))
    const tree = (await getSubjectTree(ctx.env, ctx.userId)).find(s => s.id === id)
    return Response.json(tree, { status: 201 })
  })

  on('PUT', '/api/subjects/:id', true, async (ctx) => {
    const id = ctx.params.id
    const exists = await first(ctx.env, 'SELECT id FROM subjects WHERE id = ? AND user_id = ?', id, ctx.userId)
    if (!exists) throw new HttpError(404, '科目不存在')
    const b = await body<SubjectTree>(ctx.request)
    const stmts = [
      ctx.env.DB.prepare('DELETE FROM topics WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE subject_id = ? AND user_id = ?)').bind(ctx.userId, id, ctx.userId),
      ctx.env.DB.prepare('DELETE FROM chapters WHERE subject_id = ? AND user_id = ?').bind(id, ctx.userId),
      ctx.env.DB.prepare('DELETE FROM subjects WHERE id = ? AND user_id = ?').bind(id, ctx.userId),
      ...subjectInsertStatements(ctx.env, ctx.userId, { ...b, id })
    ]
    await batch(ctx.env, stmts)
    const tree = (await getSubjectTree(ctx.env, ctx.userId)).find(s => s.id === id)
    return Response.json(tree)
  })

  // 删除科目：级联删除其学习记录/刷题/真题/错题/笔记；资料仅解除关联
  on('DELETE', '/api/subjects/:id', true, async (ctx) => {
    const id = ctx.params.id
    const exists = await first(ctx.env, 'SELECT id FROM subjects WHERE id = ? AND user_id = ?', id, ctx.userId)
    if (!exists) throw new HttpError(404, '科目不存在')
    const p = (sql: string, ...params: unknown[]) => ctx.env.DB.prepare(sql).bind(...params)
    await batch(ctx.env, [
      p('DELETE FROM topics WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE subject_id = ? AND user_id = ?)', ctx.userId, id, ctx.userId),
      p('DELETE FROM chapters WHERE subject_id = ? AND user_id = ?', id, ctx.userId),
      p('DELETE FROM subjects WHERE id = ? AND user_id = ?', id, ctx.userId),
      p('DELETE FROM study_records WHERE subject_id = ? AND user_id = ?', id, ctx.userId),
      p('DELETE FROM problem_sessions WHERE subject_id = ? AND user_id = ?', id, ctx.userId),
      p('DELETE FROM exam_records WHERE subject_id = ? AND user_id = ?', id, ctx.userId),
      p('DELETE FROM error_questions WHERE subject_id = ? AND user_id = ?', id, ctx.userId),
      p('DELETE FROM notes WHERE subject_id = ? AND user_id = ?', id, ctx.userId),
      p('UPDATE materials SET subject_id = NULL WHERE subject_id = ? AND user_id = ?', id, ctx.userId)
    ])
    return Response.json({ ok: true })
  })
}
