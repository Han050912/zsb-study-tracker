import { Users, UserCheck, UserPlus } from '@lucide/vue'
import type { Component } from 'vue'
import type { RelationStatus } from '../types'

/** 用户关系徽章（label/cls/icon 的唯一来源，供 UserRelationItem 与 RelationTag 共用） */
export const BADGES: Record<RelationStatus, { label: string; cls: string; icon: Component } | null> = {
  mutual: {
    label: '互相关注',
    cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    icon: Users
  },
  following: { label: '已关注', cls: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400', icon: UserCheck },
  follower: {
    label: '粉丝',
    cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    icon: UserPlus
  },
  none: null // 陌生人/自己不显示徽章
}
