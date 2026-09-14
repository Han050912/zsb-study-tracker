/** 管理端域 */

/** 管理端举报队列条目（target 为 null 表示内容已被作者删除；message 举报无 postId/isHidden） */
export interface AdminReport {
  id: string
  targetType: 'post' | 'comment' | 'message'
  targetId: string
  reason: string
  detail: string
  createdAt: number
  reporterName: string
  target: {
    authorName: string
    excerpt: string
    isHidden: boolean
    postId?: string
  } | null
}
