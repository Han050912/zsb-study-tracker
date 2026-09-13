/**
 * app store 的 notes 域模块：笔记 CRUD（正文走 noteBodies 服务）与学习资料 materials CRUD。
 * 仅 import staging 纯函数与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import { getNoteBody, queueNoteBody, removeNoteBody } from '../../services/noteBodies'
import type { Material, Note } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type NotesActionsShape = {
  importNotes(
    subjectId: string,
    items: { id?: string; title: string; content: string; tags: string[]; type?: Note['type'] }[]
  ): void
  saveNote(note: Partial<Note> & { subjectId: string; content?: string }): string | null
  deleteNote(id: string): void
  addMaterial(m: Omit<Material, 'id' | 'createdAt'>): void
  updateMaterial(id: string, patch: Partial<Material>): void
  deleteMaterial(id: string): void
}

export const notesActions: NotesActionsShape = {
  /** 批量导入笔记：正文进入独立本地缓存，Pinia/outbox 只保存元数据。 */
  importNotes(
    this: AppStoreThis,
    subjectId: string,
    items: { id?: string; title: string; content: string; tags: string[]; type?: Note['type'] }[]
  ) {
    const now = Date.now()
    for (const n of items) {
      const note: Note = {
        id: n.id || uid(),
        subjectId,
        title: n.title || '未命名',
        tags: n.tags,
        updatedAt: now,
        bodyUpdatedAt: n.type === 'pdf' ? 0 : now,
        type: n.type
      }
      if (n.type !== 'pdf') queueNoteBody(note.id, n.content, now)
      this.notes.push(note)
      touchRecord('notes', note, now)
    }
    this.save()
  },

  saveNote(this: AppStoreThis, note: Partial<Note> & { subjectId: string; content?: string }): string | null {
    const now = Date.now()
    if (note.id) {
      const n = this.notes.find((x) => x.id === note.id)
      if (n) {
        const bodyChanged = n.type !== 'pdf' && note.content !== undefined && note.content !== getNoteBody(n.id)
        if (bodyChanged) queueNoteBody(n.id, note.content!, now)
        Object.assign(n, {
          subjectId: note.subjectId,
          title: note.title ?? n.title,
          tags: note.tags ?? n.tags,
          type: note.type,
          bodyUpdatedAt: bodyChanged ? now : n.bodyUpdatedAt
        })
        touchRecord('notes', n, now)
        this.save()
        return n.id
      }
    } else {
      const created: Note = {
        id: uid(),
        subjectId: note.subjectId,
        title: note.title || '未命名',
        tags: note.tags || [],
        updatedAt: now,
        bodyUpdatedAt: note.type === 'pdf' ? 0 : now,
        type: note.type
      }
      if (created.type !== 'pdf') queueNoteBody(created.id, note.content || '', now)
      this.notes.push(created)
      touchRecord('notes', created, created.updatedAt)
      this.save()
      return created.id
    }
    return null
  },

  deleteNote(this: AppStoreThis, id: string) {
    const note = this.notes.find((n) => n.id === id)
    this.notes = this.notes.filter((n) => n.id !== id)
    removeNoteBody(id)
    // Markdown/PDF 分片由服务端在墓碑被接受时于同一 batch 清理。
    if (note) stageDelete('notes', id, Date.now())
    this.save()
  },

  addMaterial(this: AppStoreThis, m: Omit<Material, 'id' | 'createdAt'>) {
    const material: Material = { ...m, id: uid(), createdAt: Date.now() }
    this.materials.push(material)
    touchRecord('materials', material)
    this.save()
  },

  updateMaterial(this: AppStoreThis, id: string, patch: Partial<Material>) {
    const m = this.materials.find((x) => x.id === id)
    if (m) {
      Object.assign(m, patch)
      touchRecord('materials', m)
      this.save()
    }
  },

  deleteMaterial(this: AppStoreThis, id: string) {
    const m = this.materials.find((x) => x.id === id)
    this.materials = this.materials.filter((x) => x.id !== id)
    if (m) stageDelete('materials', id, Date.now())
    this.save()
  }
}
