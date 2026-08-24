import type { AppState, Subject } from '../types'

/** 高数考纲章节（专升本通用） */
const mathChapters = [
  { id: 'm1', name: '第一章 函数与极限', topics: ['函数及其性质', '数列极限', '函数极限', '无穷小与无穷大', '极限运算法则', '两个重要极限', '函数的连续性'] },
  { id: 'm2', name: '第二章 导数与微分', topics: ['导数概念', '求导法则', '复合函数求导', '隐函数求导', '高阶导数', '微分及其应用'] },
  { id: 'm3', name: '第三章 微分中值定理与导数应用', topics: ['罗尔定理', '拉格朗日中值定理', '洛必达法则', '单调性与极值', '凹凸性与拐点', '最值应用题'] },
  { id: 'm4', name: '第四章 不定积分', topics: ['原函数与不定积分', '换元积分法', '分部积分法', '有理函数积分'] },
  { id: 'm5', name: '第五章 定积分及其应用', topics: ['定积分概念与性质', '牛顿-莱布尼茨公式', '定积分换元与分部', '广义积分', '平面图形面积', '旋转体体积'] },
  { id: 'm6', name: '第六章 微分方程', topics: ['微分方程基本概念', '可分离变量方程', '一阶线性方程', '二阶常系数齐次方程', '二阶常系数非齐次方程'] },
  { id: 'm7', name: '第七章 多元函数微积分', topics: ['偏导数', '全微分', '复合函数微分法', '二元函数极值', '二重积分'] },
  { id: 'm8', name: '第八章 无穷级数', topics: ['数项级数敛散性', '正项级数审敛法', '交错级数', '幂级数', '函数展开成幂级数'] }
]

const engChapters = [
  { id: 'e1', name: '词汇', topics: ['高频词汇', '中频词汇', '低频词汇', '词组搭配'] },
  { id: 'e2', name: '语法', topics: ['时态语态', '非谓语动词', '虚拟语气', '定语从句', '名词性从句', '状语从句', '倒装与强调'] },
  { id: 'e3', name: '阅读理解', topics: ['细节理解', '主旨大意', '推理判断', '词义猜测'] },
  { id: 'e4', name: '写作', topics: ['应用文', '议论文', '图表作文', '模板句型'] },
  { id: 'e5', name: '翻译', topics: ['英译汉', '汉译英'] },
  { id: 'e6', name: '听力', topics: ['短对话', '长对话', '短文理解'] }
]

export function defaultSubjects(): Subject[] {
  return [
    { id: 'math', name: '高等数学', icon: '📐', color: '#3b82f6', weight: 50, builtin: true, chapters: mathChapters, mastery: {}, topicImportance: {} },
    { id: 'english', name: '英语', icon: '📖', color: '#10b981', weight: 50, builtin: true, chapters: engChapters, mastery: {}, topicImportance: {} }
  ]
}

export const MOODS = ['开心', '满足', '平静', '拼搏', '疲惫', '焦虑', '沮丧', '崩溃']

export const DEFAULT_QUOTES = [
  '宝剑锋从磨砺出，梅花香自苦寒来。',
  '你现在的努力，藏着十年后的自己。',
  '专升本不是终点，而是新的起点。',
  '天道酬勤，厚德载物。',
  '坚持就是胜利，放弃才是失败。',
  '每一次想要放弃的时候，想想为什么开始。',
  '星光不问赶路人，时光不负有心人。',
  '种一棵树最好的时间是十年前，其次是现在。'
]

export interface AchievementDef {
  id: string
  name: string
  desc: string
  icon: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_checkin', name: '初出茅庐', desc: '首次学习打卡', icon: '🌱' },
  { id: 'streak_7', name: '持之以恒', desc: '连续学习 7 天', icon: '🔥' },
  { id: 'streak_30', name: '月满则盈', desc: '连续学习 30 天', icon: '🌕' },
  { id: 'hours_100', name: '百炼成钢', desc: '累计学习 100 小时', icon: '⚔️' },
  { id: 'error_50', name: '错题克星', desc: '错题复习 50 道', icon: '🎯' },
  { id: 'problems_1000', name: '刷题达人', desc: '累计完成 1000 道题', icon: '🏆' },
  { id: 'all_subjects', name: '全面发展', desc: '一天内学习所有科目', icon: '🌟' },
  { id: 'pomodoro_50', name: '专注大师', desc: '累计完成 50 个番茄钟', icon: '🍅' },
  { id: 'points_5000', name: '学富五车', desc: '累计获得 5000 积分', icon: '💎' },
  { id: 'early_bird', name: '早起鸟儿', desc: '连续 7 天记录晨读习惯', icon: '🐦' }
]

export const LEVELS = [
  { name: '青铜', min: 0, color: '#cd7f32' },
  { name: '白银', min: 500, color: '#9ca3af' },
  { name: '黄金', min: 1500, color: '#f59e0b' },
  { name: '铂金', min: 3000, color: '#06b6d4' },
  { name: '钻石', min: 5000, color: '#3b82f6' },
  { name: '王者', min: 10000, color: '#a855f7' }
]

/** 社区广场预设话题标签（与科目体系对应） */
export const COMMUNITY_TAGS = ['#每日打卡', '#高等数学', '#英语', '#升本经验', '#笔记分享', '#心情树洞']

/** 社区徽章目录：key 与 worker/src/api/badges.ts BADGE_DEFS 一一对应（服务端发放、公开可见、永久保留） */
export interface CommunityBadgeDef {
  key: string
  name: string
  desc: string
  icon: string
}

export const COMMUNITY_BADGES: CommunityBadgeDef[] = [
  { key: 'first_post', name: '首次发帖', desc: '发布第一篇社区帖子', icon: '🌱' },
  { key: 'first_question', name: '首次提问', desc: '提出第一个问题', icon: '❓' },
  { key: 'streak_7', name: '连续打卡 7 天', desc: '连续学习打卡满 7 天', icon: '🔥' },
  { key: 'streak_30', name: '连续打卡 30 天', desc: '连续学习打卡满 30 天', icon: '🌕' },
  { key: 'streak_100', name: '连续打卡 100 天', desc: '连续学习打卡满 100 天', icon: '👑' },
  { key: 'likes_100', name: '百赞达人', desc: '帖子与评论累计获赞 100', icon: '❤️' },
  { key: 'answer_expert', name: '答疑专家', desc: '回答被采纳满 10 次', icon: '🎓' },
  { key: 'image_50', name: '图片达人', desc: '累计上传 50 张图片', icon: '📸' },
  { key: 'team_champion', name: '团队冠军', desc: '参与的小组挑战全员达标', icon: '🏆' }
]

/** 按积分换算等级（与 store.level getter 同一口径） */
export function levelOf(points: number) {
  let cur = LEVELS[0]
  for (const l of LEVELS) if (points >= l.min) cur = l
  return cur
}

/** 与设置页每日目标双向同步的固定习惯 id（默认习惯，id 稳定不受重命名影响） */
export const VOCAB_HABIT_ID = 'h2'
export const PROBLEM_HABIT_ID = 'h3'

export function createDefaultState(): AppState {
  return {
    subjects: defaultSubjects(),
    records: [],
    problemSessions: [],
    errorQuestions: [],
    exams: [],
    notes: [],
    english: { vocab: [], reading: [], listening: [], templates: [] },
    summaries: {},
    habits: [
      { id: 'h1', name: '早起晨读', type: 'checkbox', records: {} },
      { id: VOCAB_HABIT_ID, name: '每日背单词', type: 'count', target: 50, records: {} },
      { id: PROBLEM_HABIT_ID, name: '每日做题', type: 'count', target: 30, records: {} },
      { id: 'h4', name: '回顾笔记', type: 'checkbox', records: {} },
      { id: 'h5', name: '熬夜', type: 'count', bad: true, records: {} },
      { id: 'h6', name: '无效刷手机', type: 'minutes', bad: true, records: {} }
    ],
    materials: [],
    gamification: { points: 0, streak: 0, lastCheckin: '', achievements: [], pointsLog: [] },
    pomodoro: { daily: {}, interruptions: [], partialSessions: [] },
    todos: [],
    settings: {
      userName: '升本人',
      dailyGoalMinutes: 240,
      wordGoal: 50,
      problemGoal: 30,
      examDate: '',
      theme: 'light',
      reminderEnabled: false,
      reminderTime: '08:00',
      quotes: [...DEFAULT_QUOTES],
      onboarded: false,
      joinProgressBoard: false,
      profileVisibility: 'login',
      avatar: '',
      bio: '',
      doNotDisturb: false,
      dndStartTime: '',
      dndEndTime: '',
      dndMutedTypes: [],
      dndMuteMessage: false,
    }
  }
}
