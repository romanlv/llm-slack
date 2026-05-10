import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode, RefCallback } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Bookmark,
  ChevronDown,
  Copy,
  GitBranch,
  GitFork,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  SendHorizonal,
  Trash2,
  X,
} from 'lucide-react'

import { Menu, MenuItem } from '@/components/ui/menu'

import { sendParentChatTurn, sendThreadTurn } from '@/features/chat/send-turn'
import {
  db,
  deleteMessage,
  editMessageContent,
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
} from '@/features/chat/repository'
import { OPENROUTER_TRENDING_MODELS } from '@/features/providers/openrouter-models'
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
    <div className="min-w-0 max-w-full space-y-1.5 overflow-hidden whitespace-pre-wrap break-words text-body [overflow-wrap:anywhere]">
      {lines.map((line, index) => {
        if (!line.trim()) {
          return <div className="h-1" key={`space-${index}`} />
        }

        if (line.startsWith('# ')) {
          return (
            <h2 className="text-h1 font-bold tracking-tight" key={`${line}-${index}`}>
              {renderInline(line.slice(2))}
            </h2>
          )
        }

        if (line.startsWith('## ')) {
          return (
            <h3 className="text-title font-bold tracking-tight" key={`${line}-${index}`}>
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
      <div className="flex size-7 shrink-0 items-center justify-center rounded bg-accent font-mono text-h1 font-bold leading-none text-white">
        ~
      </div>
    )
  }

  if (message.role === 'system') {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded bg-ink-muted font-mono text-meta font-bold text-white">
        SYS
      </div>
    )
  }

  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded bg-yellow font-mono text-meta font-black text-sidebar">
      MC
    </div>
  )
}

async function copyMessageContent(content: string) {
  if (!navigator.clipboard) {
    return
  }
  try {
    await navigator.clipboard.writeText(content)
  } catch {
    // Clipboard access can be denied; ignore so the menu still closes.
  }
}

function MessageEditor({
  initialValue,
  onCancel,
  onSave,
}: {
  initialValue: string
  onCancel: () => void
  onSave: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.focus()
    const length = element.value.length
    element.setSelectionRange(length, length)
  }, [])

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    const nextHeight = Math.min(Math.max(element.scrollHeight, 60), 320)
    element.style.height = `${nextHeight}px`
  }, [value])

  const submit = async () => {
    if (saving) {
      return
    }

    if (!value.trim()) {
      setError('Message cannot be empty.')
      return
    }

    if (value === initialValue) {
      onCancel()
      return
    }

    setError(null)
    setSaving(true)

    try {
      await onSave(value)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save edit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded border border-accent-border bg-surface p-2">
      <textarea
        className="min-h-[60px] w-full resize-none border-0 bg-transparent text-body text-ink outline-none"
        disabled={saving}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            return
          }

          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        ref={textareaRef}
        value={value}
      />
      {error ? <p className="mb-1 text-meta text-danger">{error}</p> : null}
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <button
          className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-pill text-ink-muted transition hover:bg-surface-muted disabled:opacity-50"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-send px-2.5 py-0.5 font-mono text-pill font-bold text-white transition hover:bg-send-hover disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving || !value.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const replyCount = message.directReplyCount
  const hasReplies = replyCount > 0
  const isError = message.status === 'error'
  const canEdit = message.role === 'user' && message.status !== 'streaming'

  const handleDelete = async () => {
    const cascadeWarning = hasReplies
      ? `This message has ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} in a branch. Deleting it removes the branch and any replies.`
      : 'Delete this message?'
    if (!window.confirm(cascadeWarning)) {
      return
    }

    await deleteMessage(message.id)
  }

  return (
    <article
      className={cn(
        'group relative flex gap-3 px-5 py-1.5 transition hover:bg-surface-hover',
        active ? 'border-l-2 border-pin bg-pin-bg' : 'border-l-2 border-transparent',
        compact ? 'px-4' : '',
      )}
    >
      <Avatar message={message} />
      <div className="min-w-0 max-w-full flex-1 overflow-hidden">
        <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
          <span className="text-body font-bold text-ink">{authorLabel(message)}</span>
          {message.role === 'assistant' && message.model ? (
            <span className="rounded border border-line bg-surface-muted px-1 py-px font-mono text-meta text-ink-muted">
              {modelShortName(message.model)}
            </span>
          ) : null}
          <span className="font-mono text-meta text-ink-dim">
            {formatTime(message.createdAt)}
          </span>
          {message.status === 'streaming' ? (
            <span className="inline-flex items-center gap-1 font-mono text-meta text-accent">
              <LoaderCircle className="size-3 animate-spin" />
              streaming
            </span>
          ) : null}
          {isError ? (
            <span className="font-mono text-meta font-bold text-danger">error</span>
          ) : null}
          {message.editedAt ? (
            <span className="font-mono text-meta text-ink-dim">(edited)</span>
          ) : null}
        </div>

        {editing ? (
          <MessageEditor
            initialValue={message.content}
            onCancel={() => setEditing(false)}
            onSave={async (next) => {
              await editMessageContent(message.id, next)
              setEditing(false)
            }}
          />
        ) : (
          <MessageText content={message.content} streaming={message.status === 'streaming'} />
        )}

        {message.error ? (
          <p className="mt-2 text-meta leading-5 text-danger">{message.error}</p>
        ) : null}

        {hasReplies ? (
          <button
            className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded border border-line border-l-2 border-l-accent bg-surface px-2 py-1 text-tab font-semibold text-ink transition hover:border-accent-border hover:text-accent"
            onClick={() => onOpenThread(message.id)}
            type="button"
          >
            <GitBranch className="size-3 text-accent" />
            {replyCount} {replyCount === 1 ? 'msg' : 'msgs'}
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          'absolute right-4 -top-3 overflow-hidden rounded border border-line-strong bg-surface shadow-[0_2px_6px_rgba(0,0,0,0.08)]',
          menuOpen ? 'flex' : 'hidden group-hover:flex',
        )}
      >
        <button
          className="inline-flex items-center gap-1 border-r border-line px-2 py-1 font-mono text-pill font-bold text-accent transition hover:bg-accent-soft"
          onClick={() => onOpenThread(message.id)}
          type="button"
        >
          <GitBranch className="size-3" />
          branch
        </button>
        <button className="border-r border-line px-2 py-1 font-mono text-pill text-ink-muted transition hover:bg-surface-muted" type="button">
          <Bookmark className="size-3" />
        </button>
        <button className="border-r border-line px-2 py-1 font-mono text-pill text-ink-muted transition hover:bg-surface-muted" type="button">
          <Pin className="size-3" />
        </button>
        <Menu
          onOpenChange={setMenuOpen}
          open={menuOpen}
          trigger={(triggerProps) => (
            <button
              aria-expanded={triggerProps['aria-expanded']}
              aria-haspopup={triggerProps['aria-haspopup']}
              aria-label="Message actions"
              className="px-2 py-1 font-mono text-pill text-ink-muted transition hover:bg-surface-muted"
              onClick={triggerProps.onClick}
              ref={triggerProps.ref as RefCallback<HTMLButtonElement>}
              type="button"
            >
              <MoreHorizontal className="size-3" />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuItem
                onSelect={() => {
                  void copyMessageContent(message.content)
                  close()
                }}
              >
                <Copy className="size-3.5 text-ink-muted" />
                Copy message
              </MenuItem>
              {canEdit ? (
                <MenuItem
                  onSelect={() => {
                    setEditing(true)
                    close()
                  }}
                >
                  <Pencil className="size-3.5 text-ink-muted" />
                  Edit message
                </MenuItem>
              ) : null}
              <MenuItem
                destructive
                onSelect={() => {
                  void handleDelete()
                  close()
                }}
              >
                <Trash2 className="size-3.5" />
                Delete message
              </MenuItem>
            </>
          )}
        </Menu>
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
    <label className="inline-flex h-[22px] min-w-0 max-w-full items-center gap-1 rounded-xs border border-line bg-surface-muted px-1.5 font-mono text-meta text-ink">
      <span className="leading-none text-accent">●</span>
      <select
        className="min-w-0 max-w-32 bg-transparent text-ink outline-none disabled:opacity-60"
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
      <ChevronDown className="size-2.5 text-ink-dim" />
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
      className="inline-flex h-[22px] items-center gap-1.5 rounded-xs border border-line bg-surface-muted px-1.5 font-mono text-meta text-ink-muted"
      title={usage ? inputOutputLabel : 'Provider token usage appears after a completed reply.'}
    >
      <span
        className="relative size-3 rounded-full border border-line"
        style={{
          background:
            usage && typeof percentUsed === 'number'
              ? `conic-gradient(var(--send) ${circleProgress}%, color-mix(in srgb, var(--ink) 8%, transparent) 0)`
              : undefined,
        }}
      />
      <strong className="text-ink">{primary}</strong>
      <span className="text-ink-dim">·</span>
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
    <form className="px-5 pb-3.5 pt-1.5" onSubmit={onSubmit} ref={formRef}>
      <div className="overflow-hidden rounded-md border border-line-strong bg-surface">
        <div className="flex items-start gap-1.5 px-3 pt-2.5 pb-1">
          <span className="mt-px font-mono text-body text-accent">›</span>
          <textarea
            className="min-h-[22px] flex-1 resize-none border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-dim"
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
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-line px-1.5 py-1 pl-2">
          <MiniModelSelect disabled={disabled} onChange={onModelChange} value={model} />
          <ContextMeter compact={tone === 'thread'} usage={usage} />
          {tone === 'parent' ? (
            <button
              type="button"
              className="hidden h-[22px] items-center gap-1.5 rounded-xs border border-accent-border bg-surface-muted px-1.5 font-mono text-meta font-semibold text-accent transition hover:bg-accent-soft sm:inline-flex"
            >
              <GitBranch className="size-2.5" />
              reply in thread
              <span className="relative h-2 w-3.5 rounded-full bg-line-strong">
                <span className="absolute left-0.5 top-0.5 size-1.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]" />
              </span>
            </button>
          ) : null}
          <div className="flex-1" />
          <button className="rounded-xs p-1 text-ink-dim transition hover:bg-surface-muted" type="button">
            <Paperclip className="size-3.5" />
          </button>
          <button
            className="inline-flex h-[22px] items-center gap-1 rounded-xs bg-send px-3 font-mono text-pill font-bold tracking-wide text-white transition hover:bg-send-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || value.trim().length === 0}
            type="submit"
          >
            SEND
            <SendHorizonal className="size-3" />
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
    <header className="border-b border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 pb-1.5 pt-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="font-mono text-body text-ink-dim">#</span>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-title font-bold leading-tight tracking-tight text-ink outline-none"
            onChange={(event) => onRename(event.target.value)}
            value={title}
          />
        </div>
        <div className="hidden items-baseline gap-3 font-mono text-pill sm:flex">
          <span className="text-ink-dim">
            msgs <strong className="ml-1 text-ink">{messageCount}</strong>
          </span>
          <span className="text-ink-dim">
            branches <strong className="ml-1 text-accent">{branchCount}</strong>
          </span>
        </div>
        <button
          type="button"
          title="Branch map"
          className="flex size-7 items-center justify-center rounded text-ink-muted transition hover:bg-surface-muted"
        >
          <GitFork className="size-3.5" />
        </button>
      </div>
      <nav className="flex items-center gap-0.5 px-3.5">
        <button className="-mb-px border-b-2 border-accent px-2.5 pt-1.5 pb-2 text-tab font-semibold text-ink" type="button">
          Messages
        </button>
        <button className="inline-flex items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-tab font-medium text-ink-muted hover:text-ink" type="button">
          <Pin className="size-3" />
          Pinned <span className="rounded-full border border-line bg-surface-muted px-1.5 font-mono text-meta font-semibold text-ink-muted">2</span>
        </button>
        <button className="inline-flex items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-tab font-medium text-ink-muted hover:text-ink" type="button">
          <Bookmark className="size-3" />
          Saved <span className="rounded-full border border-line bg-surface-muted px-1.5 font-mono text-meta font-semibold text-ink-muted">1</span>
        </button>
        <button className="px-2.5 pt-1.5 pb-2 text-tab font-medium text-ink-muted hover:text-ink" type="button">
          Files <span className="ml-1 rounded-full border border-line bg-surface-muted px-1.5 font-mono text-meta font-semibold text-ink-muted">4</span>
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
    <div className="border-b border-accent-border bg-accent-bg px-5 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-tab">
        <Link
          className="font-semibold text-accent underline-offset-4 hover:underline"
          params={{ chatId }}
          to="/chat/$chatId"
        >
          {parentTitle}
        </Link>
        {ancestors.map((ancestor) => (
          <span className="inline-flex items-center gap-1.5" key={ancestor.thread.id}>
            <span className="font-mono text-meta text-ink-dim">›</span>
            <Link
              className="font-semibold text-accent underline-offset-4 hover:underline"
              params={{ chatId, threadId: ancestor.thread.id }}
              to="/chat/$chatId/thread/$threadId"
            >
              {branchLabel(ancestor.rootMessage)}
            </Link>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-meta text-ink-dim">›</span>
          <span className="font-bold text-ink">{branchLabel(activeRoot)}</span>
        </span>
      </div>
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="mx-5 my-4 rounded border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-tab leading-6 text-ink-muted">
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
          <h2 className="text-h1 font-semibold tracking-tight text-ink">
            Parent chat not found
          </h2>
          <p className="mt-2 max-w-md text-tab leading-6 text-ink-muted">
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
        <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l border-line-strong bg-surface">
          <header className="border-b border-line px-3.5 pb-2 pt-2.5">
            <div className="flex items-center gap-2">
              <GitBranch className="size-3.5 shrink-0 text-accent" />
              <h2 className="min-w-0 flex-1 truncate text-title font-bold tracking-tight text-ink">
                {branchLabel(rootMessage)}
              </h2>
              <button className="rounded-xs border border-line px-2 font-mono text-pill leading-5 text-ink transition hover:bg-surface-muted" type="button">
                ⋯
              </button>
              <button
                className="rounded p-0.5 leading-none text-ink-muted transition hover:text-ink"
                onClick={() =>
                  void navigate({
                    to: '/chat/$chatId',
                    params: { chatId: parentChat.id },
                  })
                }
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-meta text-ink-muted">
              <span>fork: <span className="text-ink">{rootMessage ? formatTime(rootMessage.createdAt) : 'unknown'}</span></span>
              <span>·</span>
              <span>{threadMessages.length} msgs</span>
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
        <div className="hidden items-center justify-center gap-3 border-l border-line xl:flex">
          <div className="max-w-sm text-center">
            <GitBranch className="mx-auto size-7 text-accent" />
            <h3 className="mt-4 text-h1 font-semibold text-ink">
              Branch from any message
            </h3>
            <p className="mt-2 text-tab leading-6 text-ink-muted">
              Hover a message and choose branch. Each branch can fork again without changing the parent chat.
            </p>
            <p className="mt-3 text-meta text-ink-muted">
              Configure your OpenRouter key in <Link className="underline" to="/settings">Settings</Link>.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
