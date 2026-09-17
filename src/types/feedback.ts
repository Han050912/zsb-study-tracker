/** 反馈域 */

/** 反馈问题类型 */
export type FeedbackType = 'feature' | 'bug' | 'experience' | 'other'
export type FeedbackStatus = 'pending' | 'resolved'
export interface Feedback {
  id: string
  type: FeedbackType
  content: string
  contact: string
  imageUrls: string[]
  githubIssueUrl: string | null
  status: FeedbackStatus
  createdAt: number
  userName?: string
}
