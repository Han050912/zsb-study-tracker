/** 设置域 */

import type { NotificationType } from './community'

/** 设置 */
export interface Settings {
  userName: string
  dailyGoalMinutes: number
  wordGoal: number
  problemGoal: number
  examDate: string
  theme: 'light' | 'dark' | 'auto'
  reminderEnabled: boolean
  reminderTime: string
  quotes: string[]
  /** 墨墨背单词开放 API Token（仅写入时传明文；读取永不回传） */
  maimemoToken?: string
  /** 是否已配置墨墨开放 API Token（读取用，不回传明文） */
  maimemoConnected?: boolean
  onboarded: boolean
  /** 参与学习进步榜（社区展示昵称与学习时长/刷题数排名；默认关闭） */
  joinProgressBoard: boolean
  /** 主页可见性：public 所有人 / login 登录(默认) / private 仅自己 */
  profileVisibility: 'public' | 'login' | 'private'
  /** 自定义头像相对 URL（/api/avatar/<file>；空 = 首字母兜底） */
  avatar: string
  /** 个人简介（≤100 字，我的页/访客主页展示） */
  bio: string
  /** 勿扰模式总开关 */
  doNotDisturb: boolean
  /** 勿扰开始时间 'HH:mm'（空 = 全天勿扰） */
  dndStartTime: string
  /** 勿扰结束时间 'HH:mm'（空 = 全天勿扰） */
  dndEndTime: string
  /** 勿扰期间屏蔽的通知类型 */
  dndMutedTypes: NotificationType[]
  /** 勿扰期间是否屏蔽消息 */
  dndMuteMessage: boolean
  /** 允许搭子查看我的学习数据（周报对比/定向分享；默认关闭） */
  partnerShareEnabled: boolean
  /** 允许搭子向我发送学习鼓励提醒（默认开启） */
  partnerRemindEnabled: boolean
  /** 记录级 LWW 时间戳（settings 域键 self 的同步时间戳，运行时字段，不进 UI） */
  updatedAt?: number
}
