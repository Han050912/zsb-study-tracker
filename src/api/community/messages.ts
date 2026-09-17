import { request } from '../client'
import type { CommunityMessage, MessageConversation } from '../../types'

export const messagesApi = {
  /** 私信会话列表（每 peer 最新一条 + 未读数） */
  conversations: () => request<{ conversations: MessageConversation[] }>('/api/community/messages/conversations'),
  /** 与某用户的消息记录（游标分页；打开即已读对方消息） */
  messagesWith: (peerId: string, cursor?: string | null) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return request<{ messages: CommunityMessage[]; nextCursor: string | null; markedRead: number }>(
      `/api/community/messages/with/${peerId}${qs ? `?${qs}` : ''}`
    )
  },
  /** 发送私信 */
  sendMessage: (peerId: string, content: string, imageUrls?: string[]) =>
    request<CommunityMessage>(`/api/community/messages/${peerId}`, {
      method: 'POST',
      body: JSON.stringify({ content, imageUrls })
    }),
  /** 私信未读总数（并入顶栏角标） */
  messageUnreadCount: () => request<{ count: number }>('/api/community/messages/unread-count')
}
