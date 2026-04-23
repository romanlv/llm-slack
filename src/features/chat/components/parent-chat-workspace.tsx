import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronLeft,
  CornerDownRight,
  KeyRound,
  LoaderCircle,
  MessageCircleReply,
  Slash,
  Sparkles,
} from 'lucide-react'

import { sendParentChatTurn, sendThreadTurn } from '@/features/chat/chat-runtime'
import {
  db,
  getThreadAncestorChain,
  getOrCreateThreadForMessage,
  getRootMessageForThread,
  previewText,
  renameParentChat,
  saveParentDraft,
  saveThreadDraft,
  setParentChatModel,
  setThreadModel,
  type ChatMessage,
  type ConversationThread,
  type ThreadAncestor,
} from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ModelPicker } from '@/features/model-selection/components/model-picker'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ParentChatWorkspaceProps = {
  chatId: string
  threadId?: string
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function roleLabel(message: ChatMessage) {
  if (message.role === 'assistant') {
    return 'Assistant'
  }

  if (message.role === 'system') {
    return 'System'
  }

  return 'You'
}

function breadcrumbLabel(message: ChatMessage) {
  const text = previewText(message.content)
  return text.length > 28 ? `${text.slice(0, 25)}...` : text || 'Untitled thread'
}

function MessageBlock({
  active,
  message,
  onOpenThread,
}: {
  active?: boolean
  message: ChatMessage
  onOpenThread: (messageId: string) => void
}) {
  const isUser = message.role === 'user'
  const isError = message.status === 'error'
  const replyCount = message.directReplyCount
  const hasReplies = replyCount > 0

  return (
    <div className="group space-y-3">
      <div
        className={cn(
          'max-w-3xl rounded-[1.75rem] border px-5 py-4 shadow-[0_12px_36px_-28px_rgba(15,23,42,0.45)]',
          isUser
            ? 'ml-auto border-primary/10 bg-primary text-primary-foreground'
            : isError
              ? 'mr-auto border-red-200 bg-red-50 text-red-900'
              : 'mr-auto border-border bg-white/80 text-foreground',
          active ? 'ring-2 ring-ring' : '',
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
          {message.role === 'assistant' ? (
            message.status === 'streaming' ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )
          ) : (
            <CornerDownRight className="size-3.5" />
          )}
          <span>{roleLabel(message)}</span>
          <span className="opacity-70">{formatTime(message.createdAt)}</span>
          {message.model ? <span className="opacity-70">{message.model}</span> : null}
        </div>

        <p className="whitespace-pre-wrap text-sm leading-7">
          {message.content || (message.status === 'streaming' ? '...' : '')}
        </p>

        {message.error ? (
          <p className="mt-3 text-xs leading-5 opacity-80">{message.error}</p>
        ) : null}
      </div>

      <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
        <button
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-white hover:text-foreground',
            hasReplies ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          onClick={() => onOpenThread(message.id)}
          type="button"
        >
          <MessageCircleReply className="size-3.5" />
          {replyCount > 0
            ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
            : 'Start thread'}
        </button>
      </div>
    </div>
  )
}

function ConversationComposer({
  disabled,
  hint,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  submittingLabel,
  value,
}: {
  disabled?: boolean
  hint: string
  onChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  submitLabel: string
  submittingLabel: string
  value: string
}) {
  const formRef = useRef<HTMLFormElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    const nextHeight = Math.min(Math.max(element.scrollHeight, 56), 220)
    element.style.height = `${nextHeight}px`
  }, [value])

  return (
    <form className="mx-auto w-full max-w-4xl" onSubmit={onSubmit} ref={formRef}>
      <div className="rounded-[1.75rem] border border-border bg-white/85 p-3 shadow-[0_18px_48px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl">
        <Textarea
          className="max-h-[220px] min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key !== 'Enter' || !event.metaKey || disabled) {
              return
            }

            event.preventDefault()
            formRef.current?.requestSubmit()
          }}
          placeholder={placeholder}
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{hint}</p>
          <Button disabled={disabled} type="submit">
            {disabled && value.trim().length > 0 ? submittingLabel : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function ParentChatWorkspace({
  chatId,
  threadId,
}: ParentChatWorkspaceProps) {
  const navigate = useNavigate()
  const [parentError, setParentError] = useState<string | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [sendingParent, setSendingParent] = useState(false)
  const [sendingThread, setSendingThread] = useState(false)

  const parentChat = useLiveQuery(() => db.parentChats.get(chatId), [chatId], undefined)
  const parentMessages = useLiveQuery(
    () =>
      db.messages
        .where('[conversationId+createdAt]')
        .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
        .sortBy('createdAt'),
    [chatId],
    [],
  )
  const activeThread = useLiveQuery(
    async () => {
      if (!threadId) {
        return undefined
      }

      return db.threads.get(threadId)
    },
    [threadId],
    undefined as ConversationThread | undefined,
  )
  const threadMessages = useLiveQuery(
    async () => {
      if (!threadId) {
        return []
      }

      return db.messages
        .where('[conversationId+createdAt]')
        .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
        .sortBy('createdAt')
    },
    [threadId],
    [] as ChatMessage[],
  )
  const rootMessage = useLiveQuery(
    async () => {
      if (!threadId) {
        return undefined
      }

      return getRootMessageForThread(threadId)
    },
    [threadId],
    undefined as ChatMessage | undefined,
  )
  const immediateParentThread = useLiveQuery(
    async () => {
      if (!activeThread?.parentThreadId) {
        return undefined
      }

      return db.threads.get(activeThread.parentThreadId)
    },
    [activeThread?.parentThreadId],
    undefined as ConversationThread | undefined,
  )
  const immediateParentRootMessage = useLiveQuery(
    async () => {
      if (!activeThread?.parentThreadId) {
        return undefined
      }

      return getRootMessageForThread(activeThread.parentThreadId)
    },
    [activeThread?.parentThreadId],
    undefined as ChatMessage | undefined,
  )
  const immediateParentThreadMessages = useLiveQuery(
    async () => {
      if (!activeThread?.parentThreadId) {
        return []
      }

      return db.messages
        .where('[conversationId+createdAt]')
        .between(
          [activeThread.parentThreadId, Dexie.minKey],
          [activeThread.parentThreadId, Dexie.maxKey],
        )
        .sortBy('createdAt')
    },
    [activeThread?.parentThreadId],
    [] as ChatMessage[],
  )
  const ancestorChain = useLiveQuery(
    async () => {
      if (!threadId) {
        return []
      }

      return getThreadAncestorChain(threadId)
    },
    [threadId],
    [] as ThreadAncestor[],
  )

  if (!parentChat) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Parent chat not found
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            This parent chat is missing locally. Return to the sidebar and open
            another one.
          </p>
        </div>
      </div>
    )
  }

  const openThreadForMessage = async (messageId: string) => {
    const thread = await getOrCreateThreadForMessage(messageId)
    await navigate({
      to: '/chat/$chatId/thread/$threadId',
      params: {
        chatId: parentChat.id,
        threadId: thread.id,
      },
    })
  }

  const handleParentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const prompt = parentChat.draft.trim()
    if (!prompt || sendingParent) {
      return
    }

    setParentError(null)
    setSendingParent(true)

    try {
      await sendParentChatTurn(parentChat.id, prompt)
    } catch (error) {
      setParentError(error instanceof Error ? error.message : 'Request failed.')
    } finally {
      setSendingParent(false)
    }
  }

  const handleThreadSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!activeThread) {
      return
    }

    const prompt = activeThread.draft.trim()
    if (!prompt || sendingThread) {
      return
    }

    setThreadError(null)
    setSendingThread(true)

    try {
      await sendThreadTurn(activeThread.id, prompt)
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : 'Request failed.')
    } finally {
      setSendingThread(false)
    }
  }

  const parentPane = (
    <div
      className={cn(
        'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden',
        threadId ? 'hidden xl:grid' : 'grid',
      )}
    >
      <div className="border-b border-border p-6 md:px-8 md:py-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <Badge>Parent chat</Badge>
            <Input
              className="mt-3 h-auto rounded-none border-0 bg-transparent px-0 text-3xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
              onChange={(event) => void renameParentChat(parentChat.id, event.target.value)}
              placeholder="Untitled chat"
              value={parentChat.title}
            />
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Keep the main line of thought here. Open a thread from any message to
              branch without polluting the parent chat.
            </p>
          </div>

          <ModelPicker
            className="lg:max-w-xl"
            description="Use a ranked OpenRouter pick or paste any custom model slug."
            label="Parent chat model"
            onValueChange={(model) => void setParentChatModel(parentChat.id, model)}
            value={parentChat.model}
          />
        </div>

        {parentChat.archivedAt ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This parent chat is archived. Restore it from the sidebar to continue
            using it.
          </div>
        ) : null}

        {parentError ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {parentError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 overflow-y-auto px-6 py-6 md:px-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {parentMessages.length === 0 ? (
            <div className="rounded-[1.75rem] border border-dashed border-border bg-white/70 px-5 py-6 text-sm leading-6 text-muted-foreground">
              This parent chat is empty. Send a top-level message to start the main
              conversation.
            </div>
          ) : (
            parentMessages.map((message) => (
              <MessageBlock
                key={message.id}
                message={message}
                onOpenThread={(messageId) => void openThreadForMessage(messageId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-white/40 p-4 supports-[backdrop-filter]:bg-white/20 md:px-6 md:py-5">
        <ConversationComposer
          disabled={
            sendingParent ||
            Boolean(parentChat.archivedAt) ||
            parentChat.draft.trim().length === 0
          }
          hint={`Sidebar search uses parent chat title and recent activity preview: ${previewText(parentChat.lastActivityPreview)}`}
          onChange={(value) => void saveParentDraft(parentChat.id, value)}
          onSubmit={handleParentSubmit}
          placeholder="Continue the parent chat..."
          submitLabel="Send"
          submittingLabel="Streaming..."
          value={parentChat.draft}
        />
      </div>
    </div>
  )

  const immediateParentThreadPane =
    threadId && immediateParentThread ? (
      <div className="hidden h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r border-border xl:grid">
        <div className="border-b border-border p-6 md:px-8 md:py-7">
          <div className="flex flex-col gap-4">
            <div>
              <Badge>Immediate parent</Badge>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                Parent thread
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Nested threads should branch from their most immediate parent
                conversation, not jump back to the top-level parent chat.
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Parent chat: {parentChat.title}
              </p>
            </div>

            {immediateParentRootMessage ? (
              <div className="rounded-[1.5rem] border border-border bg-white/75 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Parent root message
                </p>
                <div className="mt-3">
                  <MessageBlock
                    active
                    message={immediateParentRootMessage}
                    onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-6 md:px-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{immediateParentRootMessage?.directReplyCount ?? immediateParentThreadMessages.length} replies</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {immediateParentThreadMessages.length === 0 ? (
              <div className="rounded-[1.75rem] border border-dashed border-border bg-white/70 px-5 py-6 text-sm leading-6 text-muted-foreground">
                No messages in the immediate parent thread yet.
              </div>
            ) : (
              immediateParentThreadMessages.map((message) => (
                <MessageBlock
                  key={message.id}
                  message={message}
                  onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    ) : null

  const threadPane = threadId ? (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l border-border">
      <div className="border-b border-border p-6 md:px-8 md:py-7">
        <div className="flex flex-col gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-3">
              <button
                className="inline-flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-white hover:text-foreground"
                onClick={() =>
                  void navigate(
                    immediateParentThread
                      ? {
                          to: '/chat/$chatId/thread/$threadId',
                          params: {
                            chatId: parentChat.id,
                            threadId: immediateParentThread.id,
                          },
                        }
                      : {
                          to: '/chat/$chatId',
                          params: { chatId: parentChat.id },
                        },
                  )
                }
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Thread
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Link
                    className="rounded-md px-1 py-0.5 font-medium text-foreground underline-offset-4 transition hover:underline"
                    params={{ chatId: parentChat.id }}
                    to="/chat/$chatId"
                  >
                    {parentChat.title}
                  </Link>
                  {ancestorChain.map((ancestor) => (
                    <span className="inline-flex items-center gap-1" key={ancestor.thread.id}>
                      <Slash className="size-3" />
                      <Link
                        className="rounded-md px-1 py-0.5 underline-offset-4 transition hover:underline"
                        params={{
                          chatId: parentChat.id,
                          threadId: ancestor.thread.id,
                        }}
                        to="/chat/$chatId/thread/$threadId"
                      >
                        {breadcrumbLabel(ancestor.rootMessage)}
                      </Link>
                    </span>
                  ))}
                  {rootMessage ? (
                    <span className="inline-flex items-center gap-1">
                      <Slash className="size-3" />
                      <span className="rounded-md px-1 py-0.5 font-medium text-foreground">
                        {breadcrumbLabel(rootMessage)}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {rootMessage ? (
              <div className="rounded-[1.5rem] border border-border bg-white/75 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Root message
                </p>
                <div className="mt-3">
                  <MessageBlock
                    active
                    message={rootMessage}
                    onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Thread root message not found.
              </div>
            )}
          </div>

          {activeThread ? (
            <ModelPicker
              className="max-w-xl"
              description="Switch models for the next reply in this thread. Existing messages keep their original model labels."
              label="Thread model"
              onValueChange={(model) => void setThreadModel(activeThread.id, model)}
              value={activeThread.model}
            />
          ) : null}
        </div>

        {!activeThread ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            This thread does not exist in local storage.
          </div>
        ) : null}

        {!activeThread && !rootMessage ? null : threadError ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {threadError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 overflow-y-auto px-6 py-6 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{rootMessage?.directReplyCount ?? threadMessages.length} replies</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {threadMessages.length === 0 ? (
            <div className="rounded-[1.75rem] border border-dashed border-border bg-white/70 px-5 py-6 text-sm leading-6 text-muted-foreground">
              No replies in this thread yet. Reply here to keep the side
              conversation separate from the parent chat.
            </div>
          ) : (
            threadMessages.map((message) => (
              <MessageBlock
                key={message.id}
                message={message}
                onOpenThread={(messageId) => void openThreadForMessage(messageId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-white/40 p-4 supports-[backdrop-filter]:bg-white/20 md:px-6 md:py-5">
        <ConversationComposer
          disabled={
            !activeThread ||
            sendingThread ||
            activeThread.draft.trim().length === 0 ||
            Boolean(parentChat.archivedAt)
          }
          hint="Thread replies inherit only the ancestor context up to the root message, not later parent chat messages."
          onChange={(value) =>
            activeThread ? void saveThreadDraft(activeThread.id, value) : undefined
          }
          onSubmit={handleThreadSubmit}
          placeholder="Reply in thread..."
          submitLabel="Reply"
          submittingLabel="Streaming..."
          value={activeThread?.draft ?? ''}
        />
      </div>
    </div>
  ) : null

  return (
    <div
      className={cn(
        'h-full min-h-0 overflow-hidden',
        threadId ? 'grid xl:grid-cols-[minmax(0,1fr)_460px]' : 'grid grid-cols-1',
      )}
    >
      {immediateParentThreadPane ?? parentPane}
      {threadId ? threadPane : null}

      {!threadId && !parentMessages.length ? (
        <div className="hidden items-center justify-center gap-3 border-l border-border xl:flex">
          <div className="max-w-sm text-center">
            <KeyRound className="mx-auto size-6 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold text-foreground">
              Open a thread from any message
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Messages with replies show a reply count. Starting a thread keeps the
              side discussion separate from the parent chat.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Configure your OpenRouter key in <Link className="underline" to="/settings">Settings</Link>.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
