import {
  appendUserMessage,
  completeMessage,
  createAssistantMessage,
  db,
  failMessage,
  finalizeParentChatAfterSend,
  finalizeThreadAfterSend,
  getParentConversation,
  getThreadConversation,
  markParentDraftSent,
  markThreadDraftSent,
  syncRootReplyCountForThread,
  updateMessage,
} from '@/features/chat/repository'
import { getSettings } from '@/features/settings/settings-repository'
import { sendOpenRouterChat } from '@/features/providers/openrouter'

const APPROX_CONTEXT_CHAR_LIMIT = 48_000

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'The request failed before a response completed.'
}

function estimateContextSize(messages: Array<{ content: string }>) {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

export async function sendParentChatTurn(parentChatId: string, prompt: string) {
  const parentChat = await db.parentChats.get(parentChatId)
  if (!parentChat) {
    throw new Error('Parent chat not found.')
  }

  const runtimeSettings = await getSettings()
  if (!runtimeSettings.openRouterApiKey.trim()) {
    throw new Error('Add an OpenRouter API key in Settings before sending.')
  }

  const trimmed = prompt.trim()
  await markParentDraftSent(parentChatId, trimmed)

  await appendUserMessage({
    conversationType: 'parent',
    conversationId: parentChatId,
    parentChatId,
    prompt: trimmed,
    model: parentChat.model,
  })

  const assistantMessage = await createAssistantMessage({
    conversationType: 'parent',
    conversationId: parentChatId,
    parentChatId,
    model: parentChat.model,
  })

  try {
    const conversation = await getParentConversation(parentChatId)
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(
        'This parent chat is too long for the current browser-side safety limit. Start a new parent chat or continue in a thread.',
      )
    }

    let assistantContent = ''

    const response = await sendOpenRouterChat({
      apiKey: runtimeSettings.openRouterApiKey.trim(),
      model: parentChat.model,
      messages: conversation,
      onChunk: (chunk) => {
        assistantContent += chunk
        void updateMessage(assistantMessage.id, {
          content: assistantContent,
          status: 'streaming',
        })
      },
      onMessageId: (id) => {
        void updateMessage(assistantMessage.id, { providerRequestId: id })
      },
      siteName: runtimeSettings.siteName,
      siteUrl: runtimeSettings.siteUrl,
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await finalizeParentChatAfterSend(parentChatId, trimmed, finalContent)
  } catch (error) {
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await finalizeParentChatAfterSend(parentChatId, trimmed, `Request failed: ${message}`)
    throw new Error(message)
  }
}

export async function sendThreadTurn(threadId: string, prompt: string) {
  const thread = await db.threads.get(threadId)
  if (!thread) {
    throw new Error('Thread not found.')
  }

  const runtimeSettings = await getSettings()
  if (!runtimeSettings.openRouterApiKey.trim()) {
    throw new Error('Add an OpenRouter API key in Settings before sending.')
  }

  const trimmed = prompt.trim()
  await markThreadDraftSent(threadId, thread.parentChatId, trimmed)

  await appendUserMessage({
    conversationType: 'thread',
    conversationId: threadId,
    parentChatId: thread.parentChatId,
    prompt: trimmed,
    model: thread.model,
  })

  await syncRootReplyCountForThread(threadId)

  const assistantMessage = await createAssistantMessage({
    conversationType: 'thread',
    conversationId: threadId,
    parentChatId: thread.parentChatId,
    model: thread.model,
  })

  await syncRootReplyCountForThread(threadId)

  try {
    const conversation = await getThreadConversation(threadId)
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(
        'This thread is too long for the current browser-side safety limit. Start a new thread from a narrower message or open a fresh parent chat.',
      )
    }

    let assistantContent = ''

    const response = await sendOpenRouterChat({
      apiKey: runtimeSettings.openRouterApiKey.trim(),
      model: thread.model,
      messages: conversation,
      onChunk: (chunk) => {
        assistantContent += chunk
        void updateMessage(assistantMessage.id, {
          content: assistantContent,
          status: 'streaming',
        })
      },
      onMessageId: (id) => {
        void updateMessage(assistantMessage.id, { providerRequestId: id })
      },
      siteName: runtimeSettings.siteName,
      siteUrl: runtimeSettings.siteUrl,
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await finalizeThreadAfterSend(threadId, thread.parentChatId, trimmed, finalContent)
  } catch (error) {
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await finalizeThreadAfterSend(
      threadId,
      thread.parentChatId,
      trimmed,
      `Request failed: ${message}`,
    )
    throw new Error(message)
  }
}
