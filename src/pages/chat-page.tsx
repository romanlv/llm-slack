import { useParams } from '@tanstack/react-router'

import { ParentChatWorkspace } from '@/features/chat/components/parent-chat-workspace'

export function ChatPage() {
  const { chatId } = useParams({ from: '/_chat-shell/chat/$chatId' })

  return <ParentChatWorkspace chatId={chatId} />
}
