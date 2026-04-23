import { useParams } from '@tanstack/react-router'

import { ParentChatWorkspace } from '@/features/chat/components/parent-chat-workspace'

export function ChatThreadPage() {
  const { chatId, threadId } = useParams({ from: '/chat/$chatId/thread/$threadId' })

  return <ParentChatWorkspace chatId={chatId} threadId={threadId} />
}
