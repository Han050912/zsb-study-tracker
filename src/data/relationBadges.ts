import { Users, UserCheck, UserPlus } from '@lucide/vue'
import type { Component } from 'vue'
import type { RelationStatus } from '../types'

/** 用户关系徽章（label/cls/icon 的唯一来源，供 UserRelationItem 与 RelationTag 共用） */
export const BADGES: Record<RelationStatus, { label: string; cls: string; icon: Component } | null> = {
  mutual: {
    label: '互相关注',
    cls: 'bg-action-soft text-action',
    icon: Users
  },
  following: { label: '已关注', cls: 'bg-surface-soft text-muted', icon: UserCheck },
  follower: {
    label: '粉丝',
    cls: 'bg-surface-soft text-muted',
    icon: UserPlus
  },
  none: null // 陌生人/自己不显示徽章
}
