/**
 * app store 的 english 域模块：背单词/阅读/听力打卡与作文模板 CRUD。
 * 仅 import staging 纯函数与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid, today } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchEnglish } from './staging'
import type { VocabRecord, ReadingRecord, ListeningRecord, EssayTemplate } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type EnglishActionsShape = {
  addVocabRecord(newWords: number, reviewWords: number): void
  deleteVocabRecord(id: string): void
  addReadingRecord(wpm: number, accuracy: number): void
  addListeningRecord(minutes: number, material: string, mode: '精听' | '泛听'): void
  saveEssayTemplate(tpl: Omit<EssayTemplate, 'id' | 'updatedAt'> & { id?: string }): void
  deleteEssayTemplate(id: string): void
}

export const englishActions: EnglishActionsShape = {
  /** 背单词逐条打卡：每次背诵单独生成一条记录 */
  addVocabRecord(this: AppStoreThis, newWords: number, reviewWords: number) {
    const points = Math.round((newWords + reviewWords) / 20)
    const record: VocabRecord = { id: uid(), date: today(), newWords, reviewWords, points }
    this.english.vocab.push(record)
    if (points > 0) this.addPoints(points, '背单词', record.id)
    touchEnglish('vocab', record)
    this.save()
  },

  /** 删除单条背单词打卡记录：积分全额回收 + 删除对应积分流水（english 域服务端无删除自动撤销 → 发 revoke 事件） */
  deleteVocabRecord(this: AppStoreThis, id: string) {
    this.revokePointsByRef(id, true)
    const v = this.english.vocab.find((x) => x.id === id)
    this.english.vocab = this.english.vocab.filter((x) => x.id !== id)
    if (v) stageDelete('english', `vocab:${id}`, Date.now())
    this.save()
  },

  /** 保存阅读训练记录（+5 积分，refId 关联） */
  addReadingRecord(this: AppStoreThis, wpm: number, accuracy: number) {
    const record: ReadingRecord = { id: uid(), date: today(), wpm, accuracy }
    this.english.reading.push(record)
    this.addPoints(5, '阅读训练', record.id!)
    touchEnglish('reading', record)
    this.save()
  },

  /** 保存听力练习记录（每 10 分钟 +1 积分，refId 关联） */
  addListeningRecord(this: AppStoreThis, minutes: number, material: string, mode: '精听' | '泛听') {
    const record: ListeningRecord = { id: uid(), date: today(), minutes, material, mode }
    this.english.listening.push(record)
    const pts = Math.round(minutes / 10)
    if (pts > 0) this.addPoints(pts, '听力练习', record.id!)
    touchEnglish('listening', record)
    this.save()
  },

  /** 保存作文模板（新增或编辑）；english 键 = template:<id> */
  saveEssayTemplate(this: AppStoreThis, tpl: Omit<EssayTemplate, 'id' | 'updatedAt'> & { id?: string }) {
    const ts = Date.now()
    if (tpl.id) {
      const t = this.english.templates.find((x) => x.id === tpl.id)
      if (!t) return
      Object.assign(t, tpl)
      touchEnglish('templates', t, ts)
    } else {
      const created: EssayTemplate = { ...tpl, id: uid() }
      this.english.templates.push(created)
      touchEnglish('templates', created, ts)
    }
    this.save()
  },

  /** 删除作文模板；english 键 = template:<id>（english 域无关联积分，删除无需积分事件） */
  deleteEssayTemplate(this: AppStoreThis, id: string) {
    const t = this.english.templates.find((x) => x.id === id)
    this.english.templates = this.english.templates.filter((x) => x.id !== id)
    if (t) stageDelete('english', `template:${id}`, Date.now())
    this.save()
  }
}
