/** 英语域：背单词/阅读/听力/作文模板 */

/** 背单词打卡记录（逐条） */
export interface VocabRecord {
  id: string
  date: string
  newWords: number
  reviewWords: number
  /** 本条打卡获得的积分（删除时全额回收） */
  points: number
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 英语阅读训练记录 */
export interface ReadingRecord {
  /** id 用于积分流水关联（refId），旧数据迁移时自动补齐 */
  id?: string
  date: string
  wpm: number
  accuracy: number
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 英语听力练习记录 */
export interface ListeningRecord {
  /** id 用于积分流水关联（refId），旧数据迁移时自动补齐 */
  id?: string
  date: string
  minutes: number
  material: string
  mode: '精听' | '泛听'
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 作文模板；category 为新增可选字段（议论文/图表文/信件文），旧数据无此字段归入「自定义」 */
export interface EssayTemplate {
  id: string
  title: string
  content: string
  level: number
  category?: string
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 英语专项数据 */
export interface EnglishExtra {
  vocab: VocabRecord[]
  reading: ReadingRecord[]
  listening: ListeningRecord[]
  templates: EssayTemplate[]
}
