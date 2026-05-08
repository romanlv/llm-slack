import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Bookmark,
  ChevronDown,
  GitBranch,
  GitFork,
  Hash,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Pin,
  SendHorizonal,
  X,
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
  type ProviderUsage,
  type ThreadAncestor,
} from '@/lib/db'
import { OPENROUTER_TRENDING_MODELS } from '@/lib/openrouter-models'
import { cn } from '@/lib/utils'

type ParentChatWorkspaceProps = {
  chatId: string
  threadId?: string
}

type ComposerTone = 'parent' | 'thread'

const AUTO_SCROLL_THRESHOLD_PX = 140

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function modelShortName(model?: string) {
  if (!model) {
    return undefined
  }

  const known = OPENROUTER_TRENDING_MODELS.find((item) => item.id === model)
  if (known) {
    return known.label
      .replace(/^Claude\s+/i, '')
      .replace(/^OpenAI\s+/i, '')
      .replace(/^Google\s+/i, '')
  }

  return model.split('/').at(-1)?.replace(/claude-/i, '') ?? model
}

function branchLabel(message?: ChatMessage) {
  if (!message) {
    return 'Untitled branch'
  }

  const text = previewText(message.content)
  return text.length > 34 ? `${text.slice(0, 31)}...` : text || 'Untitled branch'
}

function authorLabel(message: ChatMessage) {
  if (message.role === 'assistant') {
    return modelShortName(message.model) ?? 'Assistant'
  }

  if (message.role === 'system') {
    return 'System'
  }

  return 'Mira'
}

function latestProviderUsage(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && message.providerUsage) {
      return message.providerUsage
    }
  }

  return undefined
}

function tokenCount(usage?: ProviderUsage) {
  if (!usage) {
    return undefined
  }

  return (
    usage.totalTokens ??
    (typeof usage.promptTokens === 'number' && typeof usage.completionTokens === 'number'
      ? usage.promptTokens + usage.completionTokens
      : undefined)
  )
}

function formatTokenCount(tokens?: number) {
  if (typeof tokens !== 'number') {
    return 'n/a'
  }

  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(1))}m`
  }

  if (tokens >= 1_000) {
    return `${Number((tokens / 1_000).toFixed(1))}k`
  }

  return String(tokens)
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    }

    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={`${part}-${index}`}>{part.slice(1, -1)}</em>
    }

    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function MessageText({ content, streaming }: { content: string; streaming?: boolean }) {
  const lines = content ? content.split('\n') : streaming ? ['...'] : []

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-7 [overflow-wrap:anywhere]">
      {lines.map((line, index) => {
        if (!line.trim()) {
          return <div className="h-1" key={`space-${index}`} />
        }

        if (line.startsWith('# ')) {
          return (
            <h2 className="text-lg font-bold tracking-tight" key={`${line}-${index}`}>
              {renderInline(line.slice(2))}
            </h2>
          )
        }

        if (line.startsWith('## ')) {
          return (
            <h3 className="text-base font-bold tracking-tight" key={`${line}-${index}`}>
              {renderInline(line.slice(3))}
            </h3>
          )
        }

        return <p key={`${line}-${index}`}>{renderInline(line)}</p>
      })}
    </div>
  )
}

function Avatar({ message }: { message: ChatMessage }) {
  if (message.role === 'assistant') {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-[#611f69] font-mono text-lg font-bold text-white">
        ~
      </div>
    )
  }

  if (message.role === 'system') {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-slate-600 font-mono text-[11px] font-bold text-white">
        SYS
      </div>
    )
  }

  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-[#ecb22e] font-mono text-[11px] font-black text-[#3f0e40]">
      MC
    </div>
  )
}

function MessageBlock({
  active,
  compact,
  message,
  onOpenThread,
}: {
  active?: boolean
  compact?: boolean
  message: ChatMessage
  onOpenThread: (messageId: string) => void
}) {
  const replyCount = message.directReplyCount
  const hasReplies = replyCount > 0
  const isError = message.status === 'error'

  return (
    <article
      className={cn(
        'group relative flex gap-3 px-5 py-2.5 transition hover:bg-[#f6f6f6]',
        active ? 'border-l-2 border-[#e8912d] bg-[#fffaf4]' : 'border-l-2 border-transparent',
        compact ? 'px-4' : '',
      )}
    >
      <Avatar message={message} />
      <div className="min-w-0 max-w-full flex-1 overflow-hidden">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="font-bold text-[#1d1c1d]">{authorLabel(message)}</span>
          {message.role === 'assistant' && message.model ? (
            <span className="rounded border border-black/10 bg-[#f4f2f0] px-1.5 py-0.5 font-mono text-[11px] text-[#616061]">
              {modelShortName(message.model)}
            </span>
          ) : null}
          <span className="font-mono text-[11px] text-[#868686]">
            {formatTime(message.createdAt)}
          </span>
          {message.status === 'streaming' ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#611f69]">
              <LoaderCircle className="size-3 animate-spin" />
              streaming
            </span>
          ) : null}
          {isError ? (
            <span className="font-mono text-[11px] font-bold text-red-600">error</span>
          ) : null}
        </div>

        <MessageText content={message.content} streaming={message.status === 'streaming'} />

        {message.error ? (
          <p className="mt-2 text-xs leading-5 text-red-700">{message.error}</p>
        ) : null}

        {hasReplies ? (
          <button
            className="mt-3 inline-flex items-center gap-2 rounded border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold text-[#1d1c1d] shadow-sm transition hover:border-[#b794b9] hover:text-[#611f69]"
            onClick={() => onOpenThread(message.id)}
            type="button"
          >
            <GitBranch className="size-4 text-[#611f69]" />
            {replyCount} {replyCount === 1 ? 'msg' : 'msgs'}
          </button>
        ) : null}
      </div>

      <div className="absolute right-6 top-1 hidden overflow-hidden rounded border border-black/10 bg-white shadow-[0_4px_16px_rgba(0,0,0,0.10)] group-hover:flex">
        <button
          className="inline-flex items-center gap-1.5 border-r border-black/10 px-3 py-1.5 font-mono text-xs font-semibold text-[#611f69] transition hover:bg-[#f9f1f9]"
          onClick={() => onOpenThread(message.id)}
          type="button"
        >
          <GitBranch className="size-3.5" />
          branch
        </button>
        <button className="px-2 text-[#616061] transition hover:bg-[#f4f2f0]" type="button">
          <Bookmark className="size-3.5" />
        </button>
        <button className="px-2 text-[#616061] transition hover:bg-[#f4f2f0]" type="button">
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>
    </article>
  )
}

function MiniModelSelect({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean
  onChange: (value: string) => void
  value: string
}) {
  const inKnownList = OPENROUTER_TRENDING_MODELS.some((model) => model.id === value)

  return (
    <label className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded border border-black/10 bg-[#f4f2f0] px-2 font-mono text-xs text-[#616061]">
      <span className="text-[#611f69]">●</span>
      <select
        className="min-w-0 max-w-36 bg-transparent text-[#1d1c1d] outline-none disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {OPENROUTER_TRENDING_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {modelShortName(model.id)}
          </option>
        ))}
        {!inKnownList ? <option value={value}>{modelShortName(value)}</option> : null}
      </select>
      <ChevronDown className="size-3" />
    </label>
  )
}

function ContextMeter({ compact, usage }: { compact?: boolean; usage?: ProviderUsage }) {
  const usedTokens = tokenCount(usage)
  const remainingTokens =
    usage?.remainingTokens ??
    (typeof usage?.contextWindowTokens === 'number' && typeof usedTokens === 'number'
      ? Math.max(usage.contextWindowTokens - usedTokens, 0)
      : undefined)
  const percentUsed =
    typeof usage?.contextWindowTokens === 'number' && typeof usedTokens === 'number'
      ? Math.min(Math.round((usedTokens / usage.contextWindowTokens) * 100), 100)
      : undefined
  const circleProgress = percentUsed ?? 0
  const primary =
    typeof percentUsed === 'number'
      ? `${percentUsed}%`
      : usage
        ? `${formatTokenCount(usedTokens)} used`
        : 'usage'
  const inputOutputLabel =
    typeof usage?.promptTokens === 'number' || typeof usage?.completionTokens === 'number'
      ? `${formatTokenCount(usage.promptTokens)} in · ${formatTokenCount(usage.completionTokens)} out`
      : usage?.provider
  const secondary =
    typeof remainingTokens === 'number'
      ? `${formatTokenCount(remainingTokens)} left`
      : compact && usage
        ? usage.provider
        : inputOutputLabel || 'after reply'

  return (
    <div
      className="inline-flex h-8 items-center gap-2 rounded border border-black/10 bg-[#f4f2f0] px-2 font-mono text-xs text-[#616061]"
      title={usage ? inputOutputLabel : 'Provider token usage appears after a completed reply.'}
    >
      <span
        className="relative size-4 rounded-full border border-black/10"
        style={{
          background:
            usage && typeof percentUsed === 'number'
              ? `conic-gradient(#007a5a ${circleProgress}%, rgba(0,0,0,0.08) 0)`
              : undefined,
        }}
      />
      <strong className="text-[#1d1c1d]">{primary}</strong>
      <span>·</span>
      <span>{secondary}</span>
    </div>
  )
}

function ConversationComposer({
  disabled,
  model,
  onChange,
  onModelChange,
  onSubmit,
  placeholder,
  tone,
  usage,
  value,
}: {
  disabled?: boolean
  model: string
  onChange: (value: string) => void
  onModelChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  tone: ComposerTone
  usage?: ProviderUsage
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
    const nextHeight = Math.min(Math.max(element.scrollHeight, 42), 180)
    element.style.height = `${nextHeight}px`
  }, [value])

  return (
    <form className="px-5 pb-5 pt-3" onSubmit={onSubmit} ref={formRef}>
      <div className="overflow-hidden rounded border border-black/15 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <div className="flex items-start gap-2 px-4 py-3">
          <span className="mt-1 font-mono text-[#611f69]">›</span>
          <textarea
            className="min-h-10 flex-1 resize-none border-0 bg-transparent text-[15px] leading-6 text-[#1d1c1d] outline-none placeholder:text-[#868686]"
            disabled={disabled}
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
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-black/10 bg-[#fbfbfb] px-3 py-2">
          <MiniModelSelect disabled={disabled} onChange={onModelChange} value={model} />
          <ContextMeter compact={tone === 'thread'} usage={usage} />
          {tone === 'parent' ? (
            <div className="hidden h-8 items-center gap-2 rounded border border-[#b794b9] px-2 font-mono text-xs font-semibold text-[#611f69] sm:inline-flex">
              <GitBranch className="size-3.5" />
              reply in thread
              <span className="h-3 w-6 rounded-full bg-[#d8d8d8]" />
            </div>
          ) : null}
          <div className="flex-1" />
          <button className="rounded px-2 py-1 text-[#616061] transition hover:bg-[#f4f2f0]" type="button">
            <Paperclip className="size-4" />
          </button>
          <button
            className="inline-flex h-8 items-center gap-1 rounded bg-[#007a5a] px-3 font-mono text-xs font-bold text-white transition hover:bg-[#00684d] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || value.trim().length === 0}
            type="submit"
          >
            SEND
            <SendHorizonal className="size-3.5" />
          </button>
        </div>
      </div>
    </form>
  )
}

function ChannelHeader({
  branchCount,
  messageCount,
  onRename,
  title,
}: {
  branchCount: number
  messageCount: number
  onRename: (title: string) => void
  title: string
}) {
  return (
    <header className="border-b border-black/10 bg-white">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Hash className="size-4 shrink-0 text-[#868686]" />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-lg font-bold tracking-tight outline-none"
            onChange={(event) => onRename(event.target.value)}
            value={title}
          />
        </div>
        <div className="hidden items-center gap-4 font-mono text-xs sm:flex">
          <span className="text-[#868686]">
            msgs <strong className="text-[#1d1c1d]">{messageCount}</strong>
          </span>
          <span className="text-[#868686]">
            branches <strong className="text-[#611f69]">{branchCount}</strong>
          </span>
          <GitFork className="size-4 text-[#616061]" />
        </div>
      </div>
      <nav className="flex items-center gap-1 px-4">
        <button className="-mb-px border-b-2 border-[#611f69] px-3 py-2 text-sm font-semibold" type="button">
          Messages
        </button>
        <button className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#616061]" type="button">
          <Pin className="size-3.5" />
          Pinned <span className="rounded-full bg-[#f4f2f0] px-1.5 font-mono text-[11px]">2</span>
        </button>
        <button className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#616061]" type="button">
          <Bookmark className="size-3.5" />
          Saved <span className="rounded-full bg-[#f4f2f0] px-1.5 font-mono text-[11px]">1</span>
        </button>
        <button className="px-3 py-2 text-sm font-medium text-[#616061]" type="button">
          Files <span className="rounded-full bg-[#f4f2f0] px-1.5 font-mono text-[11px]">4</span>
        </button>
      </nav>
    </header>
  )
}

function LineageBar({
  activeRoot,
  ancestors,
  chatId,
  parentTitle,
}: {
  activeRoot?: ChatMessage
  ancestors: ThreadAncestor[]
  chatId: string
  parentTitle: string
}) {
  if (!activeRoot) {
    return null
  }

  return (
    <div className="border-b border-[#b794b9] bg-[#f9f1f9] px-5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          className="font-semibold text-[#611f69] underline-offset-4 hover:underline"
          params={{ chatId }}
          to="/chat/$chatId"
        >
          {parentTitle}
        </Link>
        {ancestors.map((ancestor) => (
          <span className="inline-flex items-center gap-2" key={ancestor.thread.id}>
            <span className="font-mono text-[#868686]">›</span>
            <Link
              className="font-semibold text-[#611f69] underline-offset-4 hover:underline"
              params={{ chatId, threadId: ancestor.thread.id }}
              to="/chat/$chatId/thread/$threadId"
            >
              {branchLabel(ancestor.rootMessage)}
            </Link>
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-[#868686]">›</span>
          <span className="font-bold text-[#1d1c1d]">{branchLabel(activeRoot)}</span>
        </span>
      </div>
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="mx-5 my-4 rounded border border-dashed border-black/15 bg-[#fbfbfb] px-4 py-5 text-sm leading-6 text-[#616061]">
      {children}
    </div>
  )
}

function SmartMessageScrollPane({
  children,
  className,
  contentKey,
  onScroll,
  resetKey,
}: {
  children: ReactNode
  className: string
  contentKey: string
  onScroll?: () => void
  resetKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowRef = useRef(true)
  const lastScrollTopRef = useRef(0)

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight
    const scrollingUp = element.scrollTop < lastScrollTopRef.current

    if (scrollingUp && distanceFromBottom > AUTO_SCROLL_THRESHOLD_PX) {
      shouldFollowRef.current = false
    } else if (distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX) {
      shouldFollowRef.current = true
    }

    lastScrollTopRef.current = element.scrollTop
    onScroll?.()
  }

  useLayoutEffect(() => {
    shouldFollowRef.current = true
    lastScrollTopRef.current = 0
  }, [resetKey])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !shouldFollowRef.current) {
      return
    }

    element.scrollTop = element.scrollHeight
    lastScrollTopRef.current = element.scrollTop
  }, [contentKey])

  return (
    <div className={className} onScroll={handleScroll} ref={scrollRef}>
      {children}
    </div>
  )
}

export function ParentChatWorkspace({ chatId, threadId }: ParentChatWorkspaceProps) {
  const navigate = useNavigate()
  const [parentError, setParentError] = useState<string | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [sendingParent, setSendingParent] = useState(false)
  const [sendingThreadId, setSendingThreadId] = useState<string | null>(null)

  const parentChat = useLiveQuery(() => db.parentChats.get(chatId), [chatId], undefined)
  const parentMessages = useLiveQuery(
    () =>
      db.messages
        .where('[conversationId+createdAt]')
        .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
        .sortBy('createdAt'),
    [chatId],
    [] as ChatMessage[],
  )
  const branchCount = useLiveQuery(
    () => db.threads.where('parentChatId').equals(chatId).count(),
    [chatId],
    0,
  )
  const activeThread = useLiveQuery(
    async () => (threadId ? db.threads.get(threadId) : undefined),
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
    async () => (threadId ? getRootMessageForThread(threadId) : undefined),
    [threadId],
    undefined as ChatMessage | undefined,
  )
  const ancestorChain = useLiveQuery(
    async () => (threadId ? getThreadAncestorChain(threadId) : []),
    [threadId],
    [] as ThreadAncestor[],
  )
  const parentScrollContentKey = parentMessages
    .map((message) => `${message.id}:${message.content.length}:${message.status}`)
    .join('|')
  const threadScrollContentKey = threadMessages
    .map((message) => `${message.id}:${message.content.length}:${message.status}`)
    .join('|')
  const parentUsage = latestProviderUsage(parentMessages)
  const threadUsage = latestProviderUsage(threadMessages)

  if (!parentChat) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1d1c1d]">
            Parent chat not found
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-[#616061]">
            This parent chat is missing locally. Return to the sidebar and open another one.
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
    if (!prompt || sendingThreadId === activeThread.id) {
      return
    }

    setThreadError(null)
    setSendingThreadId(activeThread.id)

    try {
      await sendThreadTurn(activeThread.id, prompt)
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : 'Request failed.')
    } finally {
      setSendingThreadId((currentThreadId) =>
        currentThreadId === activeThread.id ? null : currentThreadId,
      )
    }
  }

  return (
    <div
      className={cn(
        'grid h-full min-h-0 min-w-0 overflow-hidden',
        threadId ? 'xl:grid-cols-[minmax(0,1fr)_minmax(340px,40%)] 2xl:grid-cols-[minmax(0,1fr)_460px]' : 'grid-cols-1',
      )}
    >
      <section className={cn('min-w-0 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]', threadId ? 'hidden xl:grid' : '')}>
        <ChannelHeader
          branchCount={branchCount}
          messageCount={parentMessages.length}
          onRename={(title) => void renameParentChat(parentChat.id, title)}
          title={parentChat.title}
        />
        <LineageBar
          activeRoot={rootMessage}
          ancestors={ancestorChain}
          chatId={parentChat.id}
          parentTitle={parentChat.title}
        />

        <SmartMessageScrollPane
          className="min-h-0 overflow-y-auto bg-white py-2"
          contentKey={parentScrollContentKey}
          resetKey={chatId}
        >
          {parentChat.archivedAt ? (
            <EmptyState>This parent chat is archived. Restore it from the sidebar to continue.</EmptyState>
          ) : null}

          {parentError ? <EmptyState>{parentError}</EmptyState> : null}

          {parentMessages.length === 0 ? (
            <EmptyState>
              This channel is empty. Send a top-level message, then use the branch action on any message to fork the conversation.
            </EmptyState>
          ) : (
            parentMessages.map((message) => (
              <MessageBlock
                key={message.id}
                message={message}
                onOpenThread={(messageId) => void openThreadForMessage(messageId)}
              />
            ))
          )}
        </SmartMessageScrollPane>

        <ConversationComposer
          disabled={
            sendingParent ||
            Boolean(parentChat.archivedAt)
          }
          model={parentChat.model}
          onChange={(value) => void saveParentDraft(parentChat.id, value)}
          onModelChange={(model) => void setParentChatModel(parentChat.id, model)}
          onSubmit={handleParentSubmit}
          placeholder="Ask anything, or /branch to fork this convo..."
          tone="parent"
          usage={parentUsage}
          value={parentChat.draft}
        />
      </section>

      {threadId ? (
        <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l border-black/15 bg-white">
          <header className="border-b border-black/10 px-5 py-3">
            <div className="flex items-center gap-3">
              <GitBranch className="size-4 shrink-0 text-[#611f69]" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold tracking-tight">
                  {branchLabel(rootMessage)}
                </h2>
                <div className="mt-1 flex items-center gap-2 font-mono text-xs text-[#616061]">
                  <span>fork: {rootMessage ? formatTime(rootMessage.createdAt) : 'unknown'}</span>
                  <span>·</span>
                  <span>{threadMessages.length} msgs</span>
                </div>
              </div>
              <button className="rounded border border-black/10 px-2 py-1 text-[#616061] transition hover:bg-[#f4f2f0]" type="button">
                <MoreHorizontal className="size-4" />
              </button>
              <button
                className="rounded p-1 text-[#616061] transition hover:bg-[#f4f2f0] hover:text-[#1d1c1d]"
                onClick={() =>
                  void navigate({
                    to: '/chat/$chatId',
                    params: { chatId: parentChat.id },
                  })
                }
                type="button"
              >
                <X className="size-5" />
              </button>
            </div>
          </header>

          <SmartMessageScrollPane
            className="min-h-0 overflow-y-auto py-2"
            contentKey={threadScrollContentKey}
            resetKey={threadId ?? 'none'}
          >
            {!activeThread ? (
              <EmptyState>This branch does not exist in local storage.</EmptyState>
            ) : null}

            {threadError ? <EmptyState>{threadError}</EmptyState> : null}

            {threadMessages.length === 0 ? (
              <EmptyState>
                No messages in this branch yet. Continue here to keep the side discussion separate from the channel.
              </EmptyState>
            ) : (
              threadMessages.map((message) => (
                <MessageBlock
                  compact
                  key={message.id}
                  message={message}
                  onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                />
              ))
            )}
          </SmartMessageScrollPane>

          <ConversationComposer
            disabled={
              !activeThread ||
              sendingThreadId === activeThread.id ||
              Boolean(parentChat.archivedAt)
            }
            model={activeThread?.model ?? parentChat.model}
            onChange={(value) =>
              activeThread ? void saveThreadDraft(activeThread.id, value) : undefined
            }
            onModelChange={(model) =>
              activeThread ? void setThreadModel(activeThread.id, model) : undefined
            }
            onSubmit={handleThreadSubmit}
            placeholder="Continue this branch, or /branch to fork again..."
            tone="thread"
            usage={threadUsage}
            value={activeThread?.draft ?? ''}
          />
        </aside>
      ) : null}

      {!threadId && parentMessages.length === 0 ? (
        <div className="hidden items-center justify-center gap-3 border-l border-black/10 xl:flex">
          <div className="max-w-sm text-center">
            <GitBranch className="mx-auto size-7 text-[#611f69]" />
            <h3 className="mt-4 text-lg font-semibold text-[#1d1c1d]">
              Branch from any message
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#616061]">
              Hover a message and choose branch. Each branch can fork again without changing the parent chat.
            </p>
            <p className="mt-3 text-xs text-[#616061]">
              Configure your OpenRouter key in <Link className="underline" to="/settings">Settings</Link>.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
