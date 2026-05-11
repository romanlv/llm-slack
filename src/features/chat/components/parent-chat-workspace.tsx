import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode, RefCallback } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Bookmark,
  Copy,
  GitBranch,
  GitFork,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  SendHorizonal,
  Star,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'

import { Menu, MenuItem } from '@/components/ui/menu'

import { AgentDot } from '@/features/agents/agent-dot'
import { ChannelSettingsDialog } from '@/features/chat/components/channel-settings-dialog'
import { MessageMarkdown } from '@/features/chat/components/message-markdown'
import type { ChannelParticipant } from '@/features/chat/domain'
import { sendParentChatTurn, sendThreadTurn } from '@/features/chat/send-turn'
import {
  countStartedBranchesForParentChat,
  db,
  deleteMessage,
  deleteThread,
  editMessageContent,
  listChannelParticipants,
  listPinnedMessagesForParentChat,
  getThreadAncestorChain,
  getOrCreateThreadForMessage,
  getRootMessageForThread,
  previewText,
  renameParentChat,
  saveParentDraft,
  saveThreadDraft,
  setParentChatModel,
  setThreadModel,
  togglePinnedMessage,
  toggleSavedMessage,
  toggleStarParentChat,
  type ChatMessage,
  type ConversationThread,
  type PinnedMessageWithMessage,
  type ProviderUsage,
  type ThreadAncestor,
} from '@/features/chat/repository'
import {
  type EffectiveModel,
  listEnabledModels,
} from '@/features/providers/models-catalog'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef } from '@/features/providers/model-ref'
import { listProviders } from '@/features/providers/providers-repository'
import { getAdapter } from '@/features/providers/registry'

import { MiniModelSelect } from './model-picker'
import {
  buildPickerValue,
  pickerValueFromRef,
  refFromPickerString,
} from './model-picker-helpers'
import {
  DEFAULT_USER_NAME,
  getSettings,
  userInitials,
} from '@/features/settings/settings-repository'
import { cn } from '@/lib/utils'

type ParentChatWorkspaceProps = {
  chatId: string
  threadId?: string
}

type ComposerTone = 'parent' | 'thread'
type ParentTab = 'messages' | 'pinned'

const AUTO_SCROLL_THRESHOLD_PX = 140

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function modelShortName(model?: ModelRef | null) {
  if (!model) {
    return undefined
  }

  const id = model.providerModelId
  try {
    const adapter = getAdapter(model.providerKind)
    const known = adapter.bundledCatalog().find((entry) => entry.providerModelId === id)
    if (known) {
      return known.name
        .replace(/^Claude\s+/i, '')
        .replace(/^OpenAI\s+/i, '')
        .replace(/^Google\s+/i, '')
    }
  } catch {
    // Unknown provider kind — fall through to id-derived label.
  }

  return id.split('/').at(-1)?.replace(/claude-/i, '') ?? id
}

function shortNameForModelId(id?: string) {
  if (!id) {
    return undefined
  }
  return modelShortName({ providerKind: 'openrouter', providerModelId: id })
}

function branchLabel(message?: ChatMessage) {
  if (!message) {
    return 'Untitled branch'
  }

  const text = previewText(message.content)
  return text.length > 34 ? `${text.slice(0, 31)}...` : text || 'Untitled branch'
}

function messageElementId(messageId: string) {
  return `message-row-${messageId}`
}

function authorLabel(message: ChatMessage, userName: string) {
  if (message.role === 'assistant') {
    // Agent-authored messages (agent-DM or channel) carry the agent's
    // identity in `agentSnapshot`. Falling back to the model name keeps
    // legacy model-DMs unchanged.
    if (message.agentSnapshot) {
      return message.agentSnapshot.displayName
    }
    return modelShortName(message.model) ?? 'Assistant'
  }

  if (message.role === 'system') {
    return 'System'
  }

  return userName
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

function MessageText({ content, streaming }: { content: string; streaming?: boolean }) {
  if (content) {
    return <MessageMarkdown content={content} />
  }

  if (streaming) {
    return <MessageMarkdown content="..." />
  }

  return null
}

function Avatar({
  avatarDataUrl,
  message,
  userName,
}: {
  avatarDataUrl?: string
  message: ChatMessage
  userName: string
}) {
  if (message.role === 'assistant') {
    // Agent-authored messages render with the agent's stable colored
    // marker (initials in a hashed palette slot). Model-DMs keep the
    // original "~" glyph so AE7 byte-parity holds.
    if (message.agentSnapshot) {
      return (
        <AgentDot
          agentId={message.agentId ?? undefined}
          displayName={message.agentSnapshot.displayName}
          size="md"
        />
      )
    }
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded bg-accent font-mono text-heading font-bold leading-none text-white">
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

  if (avatarDataUrl) {
    return (
      <img
        alt={`${userName} avatar`}
        className="size-7 shrink-0 rounded bg-yellow object-cover"
        src={avatarDataUrl}
      />
    )
  }

  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded bg-yellow font-mono text-meta font-black text-sidebar">
      {userInitials(userName)}
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
          className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-meta text-ink-muted transition hover:bg-surface-muted disabled:opacity-50"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-send px-2.5 py-0.5 font-mono text-meta font-bold text-white transition hover:bg-send-hover disabled:cursor-not-allowed disabled:opacity-60"
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
  isPinned,
  isSaved,
  message,
  onOpenThread,
  onSelect,
  onTogglePin,
  onToggleSaved,
  avatarDataUrl,
  userName,
}: {
  active?: boolean
  compact?: boolean
  isPinned: boolean
  isSaved: boolean
  message: ChatMessage
  onOpenThread: (messageId: string) => void
  onSelect?: () => void
  onTogglePin: (messageId: string) => Promise<void>
  onToggleSaved: (messageId: string) => Promise<void>
  avatarDataUrl?: string
  userName: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pinning, setPinning] = useState(false)
  const [saving, setSaving] = useState(false)
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

  const handleTogglePin = async () => {
    if (pinning) {
      return
    }

    setPinning(true)
    try {
      await onTogglePin(message.id)
    } finally {
      setPinning(false)
    }
  }

  const handleToggleSaved = async () => {
    if (saving) {
      return
    }

    setSaving(true)
    try {
      await onToggleSaved(message.id)
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = (eventTarget: EventTarget | null) => {
    if (!onSelect || !(eventTarget instanceof Element)) {
      return
    }

    if (eventTarget.closest('a, button, input, textarea, select, [role="menuitem"]')) {
      return
    }

    onSelect()
  }

  return (
    <article
      className={cn(
        'group relative flex gap-3 px-5 py-1.5 transition hover:bg-surface-hover',
        active ? 'border-l-2 border-pin bg-pin-bg' : 'border-l-2 border-transparent',
        compact ? 'px-4' : '',
        onSelect ? 'cursor-pointer' : '',
      )}
      id={messageElementId(message.id)}
      onClick={(event) => handleSelect(event.target)}
      onKeyDown={(event) => {
        if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) {
          return
        }

        event.preventDefault()
        onSelect()
      }}
      tabIndex={onSelect ? 0 : undefined}
    >
      <Avatar avatarDataUrl={avatarDataUrl} message={message} userName={userName} />
      <div className="min-w-0 max-w-full flex-1 overflow-hidden">
        <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
          <span className="text-body font-bold text-ink">{authorLabel(message, userName)}</span>
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
          {isPinned ? (
            <span className="inline-flex items-center gap-1 font-mono text-meta font-bold text-pin">
              <Pin className="size-3" />
              pinned
            </span>
          ) : null}
          {isSaved ? (
            <span className="inline-flex items-center gap-1 font-mono text-meta font-bold text-accent">
              <Bookmark className="size-3" />
              saved
            </span>
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
            className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded border border-line border-l-2 border-l-accent bg-surface px-2 py-1 text-small font-semibold text-ink transition hover:border-accent-border hover:text-accent"
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
          className="inline-flex items-center gap-1 border-r border-line px-2 py-1 font-mono text-meta font-bold text-accent transition hover:bg-accent-soft"
          onClick={() => onOpenThread(message.id)}
          type="button"
        >
          <GitBranch className="size-3" />
          branch
        </button>
        <button
          aria-label={isSaved ? 'Remove from saved' : 'Save message'}
          aria-pressed={isSaved}
          className={cn(
            'border-r border-line px-2 py-1 font-mono text-meta transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
            isSaved ? 'bg-accent-soft text-accent' : 'text-ink-muted',
          )}
          disabled={saving}
          onClick={() => void handleToggleSaved()}
          title={isSaved ? 'Remove from saved' : 'Save for later'}
          type="button"
        >
          <Bookmark className="size-3" />
        </button>
        <button
          aria-label={isPinned ? 'Unpin message' : 'Pin message'}
          aria-pressed={isPinned}
          className={cn(
            'border-r border-line px-2 py-1 font-mono text-meta transition hover:bg-pin-bg disabled:cursor-not-allowed disabled:opacity-60',
            isPinned ? 'bg-pin-bg text-pin' : 'text-ink-muted',
          )}
          disabled={pinning}
          onClick={() => void handleTogglePin()}
          title={isPinned ? 'Unpin message' : 'Pin message'}
          type="button"
        >
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
              className="px-2 py-1 font-mono text-meta text-ink-muted transition hover:bg-surface-muted"
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
  availableModels,
  className,
  connections,
  disabled,
  model,
  onChange,
  onModelChange,
  onSubmit,
  placeholder,
  submitDisabled,
  tone,
  usage,
  value,
}: {
  availableModels: EffectiveModel[]
  className?: string
  connections: ProviderConnection[]
  disabled?: boolean
  model: string
  onChange: (value: string) => void
  onModelChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  submitDisabled?: boolean
  tone: ComposerTone
  usage?: ProviderUsage
  value: string
}) {
  const cannotSubmit = disabled || submitDisabled
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
    <form className={cn('px-5 pb-3.5 pt-1.5', className)} onSubmit={onSubmit} ref={formRef}>
      <div className="overflow-hidden rounded-md border border-line-strong bg-surface">
        <div className="flex items-start gap-1.5 px-3 pt-2.5 pb-1">
          <span className="mt-px font-mono text-body text-accent">›</span>
          <textarea
            className="min-h-[22px] flex-1 resize-none border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-dim"
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== 'Enter' || !event.metaKey || cannotSubmit) {
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
          <MiniModelSelect
            availableModels={availableModels}
            connections={connections}
            disabled={disabled}
            fallbackLabel={(id) => shortNameForModelId(id) ?? id}
            onChange={onModelChange}
            value={model}
          />
          <ContextMeter compact={tone === 'thread'} usage={usage} />
          {/* TODO: reply-in-thread composer mode toggle — see docs/tasks.md (planned)
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
          */}
          <div className="flex-1" />
          <button className="rounded-xs p-1 text-ink-dim transition hover:bg-surface-muted" type="button">
            <Paperclip className="size-3.5" />
          </button>
          <button
            className="inline-flex h-[22px] items-center gap-1 rounded-xs bg-send px-3 font-mono text-meta font-bold tracking-wide text-white transition hover:bg-send-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={cannotSubmit || value.trim().length === 0}
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

function ThreadActionsMenu({
  disabled,
  onDelete,
}: {
  disabled?: boolean
  onDelete: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <Menu
      onOpenChange={setOpen}
      open={open}
      trigger={(triggerProps) => (
        <button
          aria-expanded={triggerProps['aria-expanded']}
          aria-haspopup={triggerProps['aria-haspopup']}
          aria-label="Branch actions"
          className="rounded-xs border border-line px-2 font-mono text-meta leading-5 text-ink transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={triggerProps.onClick}
          ref={triggerProps.ref as RefCallback<HTMLButtonElement>}
          type="button"
        >
          ⋯
        </button>
      )}
    >
      {({ close }) => (
        <MenuItem
          destructive
          onSelect={() => {
            void onDelete()
            close()
          }}
        >
          <Trash2 className="size-3.5" />
          Delete branch
        </MenuItem>
      )}
    </Menu>
  )
}

function ChannelHeader({
  activeTab,
  branchCount,
  isChannel,
  messageCount,
  onOpenChannelSettings,
  onRename,
  onTabChange,
  onToggleStar,
  participantCount,
  pinnedCount,
  starred,
  title,
}: {
  activeTab: ParentTab
  branchCount: number
  isChannel: boolean
  messageCount: number
  onOpenChannelSettings?: () => void
  onRename: (title: string) => void
  onTabChange: (tab: ParentTab) => void
  onToggleStar: () => void
  participantCount?: number
  pinnedCount: number
  starred: boolean
  title: string
}) {
  const tabClassName = (tab: ParentTab) =>
    cn(
      '-mb-px border-b-2 px-2.5 pt-1.5 pb-2 text-small font-semibold',
      activeTab === tab
        ? 'border-accent text-ink'
        : 'border-transparent text-ink-muted hover:text-ink',
    )

  const titleInputRef = useRef<HTMLInputElement>(null)
  const [draftTitle, setDraftTitle] = useState(title)

  useEffect(() => {
    if (document.activeElement !== titleInputRef.current) {
      setDraftTitle(title)
    }
  }, [title])

  return (
    <header className="border-b border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 pb-1.5 pt-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            aria-label={starred ? `Unstar ${title}` : `Star ${title}`}
            aria-pressed={starred}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded transition hover:bg-surface-muted',
              starred ? 'text-yellow' : 'text-ink-dim hover:text-ink',
            )}
            onClick={onToggleStar}
            title={starred ? 'Unstar conversation' : 'Star conversation'}
            type="button"
          >
            <Star className={cn('size-4', starred ? 'fill-yellow' : '')} />
          </button>
          <span className="font-mono text-body text-ink-dim">#</span>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-heading font-bold leading-tight tracking-tight text-ink outline-none"
            onBlur={() => setDraftTitle(title)}
            onChange={(event) => {
              setDraftTitle(event.target.value)
              onRename(event.target.value)
            }}
            ref={titleInputRef}
            value={draftTitle}
          />
        </div>
        <div className="hidden items-baseline gap-3 font-mono text-meta sm:flex">
          <span className="text-ink-dim">
            msgs <strong className="ml-1 text-ink">{messageCount}</strong>
          </span>
          <span className="text-ink-dim">
            branches <strong className="ml-1 text-accent">{branchCount}</strong>
          </span>
          {isChannel ? (
            <span className="text-ink-dim">
              agents <strong className="ml-1 text-accent">{participantCount ?? 0}</strong>
            </span>
          ) : null}
        </div>
        {isChannel && onOpenChannelSettings ? (
          <button
            className="inline-flex h-7 items-center gap-1.5 rounded border border-line bg-surface-muted px-2 font-mono text-meta font-semibold text-ink-muted transition hover:bg-canvas hover:text-ink"
            onClick={onOpenChannelSettings}
            title="Channel settings"
            type="button"
          >
            <UsersRound className="size-3.5" />
            Channel settings
          </button>
        ) : null}
        <button
          type="button"
          title="Branch map"
          className="flex size-7 items-center justify-center rounded text-ink-muted transition hover:bg-surface-muted"
        >
          <GitFork className="size-3.5" />
        </button>
      </div>
      <nav className="flex items-center gap-0.5 px-3.5">
        <button
          aria-pressed={activeTab === 'messages'}
          className={tabClassName('messages')}
          onClick={() => onTabChange('messages')}
          type="button"
        >
          Messages
        </button>
        <button
          aria-pressed={activeTab === 'pinned'}
          className={cn(tabClassName('pinned'), 'inline-flex items-center gap-1.5')}
          onClick={() => onTabChange('pinned')}
          type="button"
        >
          <Pin className="size-3" />
          Pinned <span className="rounded-full border border-line bg-surface-muted px-1.5 font-mono text-meta font-semibold text-ink-muted">{pinnedCount}</span>
        </button>
        <button
          aria-disabled="true"
          className="inline-flex items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-small font-medium text-ink-muted opacity-60"
          disabled
          type="button"
        >
          <Bookmark className="size-3" />
          Saved
        </button>
        <button
          aria-disabled="true"
          className="px-2.5 pt-1.5 pb-2 text-small font-medium text-ink-muted opacity-60"
          disabled
          type="button"
        >
          Files
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
      <div className="flex flex-wrap items-center gap-1.5 text-small">
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

function ProviderConnectBanner() {
  return (
    <div className="mx-5 mb-1 mt-2 flex items-center gap-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2">
      <KeyRound className="size-4 shrink-0 text-warn" />
      <p className="min-w-0 flex-1 text-small leading-5 text-ink">
        <span className="font-semibold">Connect an LLM provider to start chatting.</span>{' '}
        <span className="text-ink-muted">Your API key stays in this browser.</span>
      </p>
      <Link
        className="inline-flex shrink-0 items-center gap-1 rounded bg-warn px-2.5 py-1 font-mono text-meta font-bold tracking-wide text-white transition hover:opacity-90"
        to="/settings"
      >
        CONNECT
      </Link>
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="mx-5 my-4 rounded border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-small leading-6 text-ink-muted">
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
  const location = useLocation()
  const [parentError, setParentError] = useState<string | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [sendingParent, setSendingParent] = useState(false)
  const [sendingThreadId, setSendingThreadId] = useState<string | null>(null)
  const [parentTab, setParentTab] = useState<ParentTab>('messages')
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false)
  const pendingMessageJumpRef = useRef<string | null>(null)

  const parentChat = useLiveQuery(() => db.parentChats.get(chatId), [chatId], undefined)
  const channelParticipants = useLiveQuery(
    () =>
      parentChat?.kind === 'channel'
        ? listChannelParticipants(parentChat.id)
        : Promise.resolve([] as ChannelParticipant[]),
    [parentChat?.id, parentChat?.kind],
    [] as ChannelParticipant[],
  )
  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const parentMessages = useLiveQuery(
    () =>
      db.messages
        .where('[conversationId+createdAt]')
        .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
        .sortBy('createdAt'),
    [chatId],
    [] as ChatMessage[],
  )
  const parentPinnedMessages = useLiveQuery(
    () => listPinnedMessagesForParentChat(chatId),
    [chatId],
    [] as PinnedMessageWithMessage[],
  )
  const savedMessageIds = useLiveQuery(
    async () => {
      const rows = await db.savedMessages.where('parentChatId').equals(chatId).toArray()
      return new Set(rows.map((row) => row.messageId))
    },
    [chatId],
    new Set<string>(),
  )
  const branchCount = useLiveQuery(
    () => countStartedBranchesForParentChat(chatId),
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
  const parentPinnedScrollContentKey = parentPinnedMessages
    .map((pin) => `${pin.id}:${pin.message.id}:${pin.message.content.length}:${pin.message.status}`)
    .join('|')
  const threadScrollContentKey = threadMessages
    .map((message) => `${message.id}:${message.content.length}:${message.status}`)
    .join('|')
  const parentUsage = latestProviderUsage(parentMessages)
  const threadUsage = latestProviderUsage(threadMessages)
  const userName = settings?.userName ?? DEFAULT_USER_NAME
  const avatarDataUrl = settings?.avatarDataUrl
  const parentPinnedMessageIds = new Set(parentPinnedMessages.map((pin) => pin.messageId))
  const threadPinnedMessageIds = new Set(
    parentPinnedMessages
      .filter((pin) => pin.conversationId === threadId)
      .map((pin) => pin.messageId),
  )
  const parentScrollContentKeyForActiveTab =
    parentTab === 'pinned' ? parentPinnedScrollContentKey : parentScrollContentKey
  const providers = useLiveQuery(() => listProviders(), [], [])
  const availableModels = useLiveQuery(
    () => listEnabledModels(),
    [],
    [] as EffectiveModel[],
  )
  // A provider is "usable" when send-turn would accept it: either the
  // adapter doesn't require a key (Ollama-style local endpoints), or one is
  // saved on the connection. Otherwise we show the connect-a-provider
  // banner. Keep this aligned with the equivalent check in send-turn.ts.
  const hasUsableProvider = providers.some((provider) => {
    try {
      const adapter = getAdapter(provider.kind)
      return !adapter.requiresApiKey || Boolean(provider.apiKey?.trim())
    } catch {
      return false
    }
  })
  const settingsDefaultModelId = settings?.defaultModel?.providerModelId
  const settingsDefaultIsAvailable =
    settingsDefaultModelId !== undefined &&
    availableModels.some(
      (model) => model.providerModelId === settingsDefaultModelId,
    )
  const fallbackPickerValue = (() => {
    if (settingsDefaultIsAvailable && settings?.defaultModel) {
      const settingsDefault = settings.defaultModel
      const match = availableModels.find(
        (model) =>
          model.providerModelId === settingsDefault.providerModelId &&
          (!settingsDefault.providerId || model.providerId === settingsDefault.providerId),
      )
      if (match) return buildPickerValue(match.providerId, match.providerModelId)
    }
    const first = availableModels[0]
    return first ? buildPickerValue(first.providerId, first.providerModelId) : ''
  })()

  const refToPickerValue = (ref: ModelRef | null | undefined) =>
    pickerValueFromRef(ref, { availableModels, fallbackPickerValue })

  const pickerValueToRef = (value: string) =>
    refFromPickerString(value, {
      availableModels,
      settingsDefault: settings?.defaultModel,
    })

  function jumpToMessage(messageId: string) {
    const element = document.getElementById(messageElementId(messageId))
    if (typeof element?.scrollIntoView !== 'function') {
      return
    }

    element.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    const hash = location.hash
    if (!hash) {
      return
    }

    const prefix = 'message-row-'
    const target = hash.startsWith('#') ? hash.slice(1) : hash
    if (!target.startsWith(prefix)) {
      return
    }

    pendingMessageJumpRef.current = target.slice(prefix.length)
  }, [location.hash])

  useLayoutEffect(() => {
    const pendingMessageId = pendingMessageJumpRef.current
    if (!pendingMessageId) {
      return
    }

    const messageIsVisible =
      parentMessages.some((message) => message.id === pendingMessageId) ||
      threadMessages.some((message) => message.id === pendingMessageId)

    if (!messageIsVisible) {
      return
    }

    pendingMessageJumpRef.current = null
    window.requestAnimationFrame(() => jumpToMessage(pendingMessageId))
  }, [parentMessages, threadMessages])

  if (!parentChat) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
        <div>
          <h2 className="text-heading font-semibold tracking-tight text-ink">
            Conversation not found
          </h2>
          <p className="mt-2 max-w-md text-small leading-6 text-ink-muted">
            This conversation is missing locally. Return to the sidebar and open another one.
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

  const openPinnedMessage = async (pin: PinnedMessageWithMessage) => {
    pendingMessageJumpRef.current = pin.messageId
    setParentTab('messages')

    if (pin.conversationType === 'thread') {
      await navigate({
        to: '/chat/$chatId/thread/$threadId',
        params: {
          chatId: parentChat.id,
          threadId: pin.conversationId,
        },
      })
      return
    }

    await navigate({
      to: '/chat/$chatId',
      params: { chatId: parentChat.id },
    })
  }

  const toggleParentPin = async (messageId: string) => {
    setParentError(null)
    try {
      await togglePinnedMessage(messageId)
    } catch (error) {
      setParentError(error instanceof Error ? error.message : 'Could not update pinned message.')
    }
  }

  const toggleThreadPin = async (messageId: string) => {
    setThreadError(null)
    try {
      await togglePinnedMessage(messageId)
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : 'Could not update pinned message.')
    }
  }

  const toggleParentSaved = async (messageId: string) => {
    setParentError(null)
    try {
      await toggleSavedMessage(messageId)
    } catch (error) {
      setParentError(error instanceof Error ? error.message : 'Could not update saved message.')
    }
  }

  const toggleThreadSaved = async (messageId: string) => {
    setThreadError(null)
    try {
      await toggleSavedMessage(messageId)
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : 'Could not update saved message.')
    }
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
          activeTab={parentTab}
          branchCount={branchCount}
          isChannel={parentChat.kind === 'channel'}
          messageCount={parentMessages.length}
          onOpenChannelSettings={
            parentChat.kind === 'channel'
              ? () => setChannelSettingsOpen(true)
              : undefined
          }
          onRename={(title) => void renameParentChat(parentChat.id, title)}
          onTabChange={setParentTab}
          onToggleStar={() => void toggleStarParentChat(parentChat.id)}
          participantCount={channelParticipants.length}
          pinnedCount={parentPinnedMessages.length}
          starred={Boolean(parentChat.starredAt)}
          title={parentChat.title}
        />
        <LineageBar
          activeRoot={rootMessage}
          ancestors={ancestorChain}
          chatId={parentChat.id}
          parentTitle={parentChat.title}
        />

        <SmartMessageScrollPane
          className="row-start-3 min-h-0 overflow-y-auto bg-surface py-2"
          contentKey={parentScrollContentKeyForActiveTab}
          resetKey={`${chatId}:${parentTab}`}
        >
          {parentChat.archivedAt ? (
            <EmptyState>This conversation is archived. Restore it from the sidebar to continue.</EmptyState>
          ) : null}

          {parentError ? <EmptyState>{parentError}</EmptyState> : null}

          {parentTab === 'pinned' ? (
            parentPinnedMessages.length === 0 ? (
              <EmptyState>No pinned messages in this channel yet.</EmptyState>
            ) : (
              parentPinnedMessages.map((pin) => (
                <MessageBlock
                  active
                  avatarDataUrl={avatarDataUrl}
                  isPinned
                  isSaved={savedMessageIds.has(pin.message.id)}
                  key={pin.id}
                  message={pin.message}
                  onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                  onSelect={() => void openPinnedMessage(pin)}
                  onTogglePin={toggleParentPin}
                  onToggleSaved={toggleParentSaved}
                  userName={userName}
                />
              ))
            )
          ) : parentMessages.length === 0 ? (
            <EmptyState>
              This channel is empty. Send a top-level message, then use the branch action on any message to fork the conversation.
            </EmptyState>
          ) : (
            parentMessages.map((message) => (
              <MessageBlock
                avatarDataUrl={avatarDataUrl}
                active={parentPinnedMessageIds.has(message.id)}
                isPinned={parentPinnedMessageIds.has(message.id)}
                isSaved={savedMessageIds.has(message.id)}
                key={message.id}
                message={message}
                onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                onTogglePin={toggleParentPin}
                onToggleSaved={toggleParentSaved}
                userName={userName}
              />
            ))
          )}
        </SmartMessageScrollPane>

        <div className="row-start-4">
          {hasUsableProvider ? null : <ProviderConnectBanner />}
          <ConversationComposer
            availableModels={availableModels}
            connections={providers}
            disabled={
              sendingParent ||
              Boolean(parentChat.archivedAt)
            }
            model={refToPickerValue(parentChat.model)}
            onChange={(value) => void saveParentDraft(parentChat.id, value)}
            onModelChange={(model) =>
              void setParentChatModel(parentChat.id, pickerValueToRef(model))
            }
            onSubmit={handleParentSubmit}
            placeholder="Ask anything, or /branch to fork this convo..."
            submitDisabled={!hasUsableProvider}
            tone="parent"
            usage={parentUsage}
            value={parentChat.draft}
          />
        </div>
      </section>

      {threadId ? (
        <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l border-line-strong bg-surface">
          <header className="border-b border-line px-3.5 pb-2 pt-2.5">
            <div className="flex items-center gap-2">
              <GitBranch className="size-3.5 shrink-0 text-accent" />
              <h2 className="min-w-0 flex-1 truncate text-heading font-bold tracking-tight text-ink">
                {branchLabel(rootMessage)}
              </h2>
              <ThreadActionsMenu
                disabled={!activeThread}
                onDelete={async () => {
                  if (!activeThread) {
                    return
                  }

                  const messageCount = threadMessages.length
                  const confirmation =
                    messageCount === 0
                      ? 'Discard this empty branch?'
                      : `Delete this branch and its ${messageCount} ${messageCount === 1 ? 'message' : 'messages'}? Nested branches are removed too.`
                  if (!window.confirm(confirmation)) {
                    return
                  }

                  setThreadError(null)
                  try {
                    await deleteThread(activeThread.id)
                    await navigate({
                      to: '/chat/$chatId',
                      params: { chatId: parentChat.id },
                    })
                  } catch (error) {
                    setThreadError(
                      error instanceof Error ? error.message : 'Could not delete branch.',
                    )
                  }
                }}
              />
              <button
                aria-label="Close branch"
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
                  avatarDataUrl={avatarDataUrl}
                  active={threadPinnedMessageIds.has(message.id)}
                  compact
                  isPinned={threadPinnedMessageIds.has(message.id)}
                  isSaved={savedMessageIds.has(message.id)}
                  key={message.id}
                  message={message}
                  onOpenThread={(messageId) => void openThreadForMessage(messageId)}
                  onTogglePin={toggleThreadPin}
                  onToggleSaved={toggleThreadSaved}
                  userName={userName}
                />
              ))
            )}
          </SmartMessageScrollPane>

          <div>
            {hasUsableProvider ? null : <ProviderConnectBanner />}
            <ConversationComposer
              availableModels={availableModels}
              connections={providers}
              disabled={
                !activeThread ||
                sendingThreadId === activeThread.id ||
                Boolean(parentChat.archivedAt)
              }
              model={refToPickerValue(activeThread?.model ?? parentChat.model)}
              onChange={(value) =>
                activeThread ? void saveThreadDraft(activeThread.id, value) : undefined
              }
              onModelChange={(model) =>
                activeThread
                  ? void setThreadModel(activeThread.id, pickerValueToRef(model))
                  : undefined
              }
              onSubmit={handleThreadSubmit}
              placeholder="Continue this branch, or /branch to fork again..."
              submitDisabled={!hasUsableProvider}
              tone="thread"
              usage={threadUsage}
              value={activeThread?.draft ?? ''}
            />
          </div>
        </aside>
      ) : null}

      {!threadId && parentMessages.length === 0 ? (
        <div className="hidden items-center justify-center gap-3 border-l border-line xl:flex">
          <div className="max-w-sm text-center">
            <GitBranch className="mx-auto size-7 text-accent" />
            <h3 className="mt-4 text-heading font-semibold text-ink">
              Branch from any message
            </h3>
            <p className="mt-2 text-small leading-6 text-ink-muted">
              Hover a message and choose branch. Each branch can fork again without changing the main conversation.
            </p>
          </div>
        </div>
      ) : null}

      {parentChat.kind === 'channel' ? (
        <ChannelSettingsDialog
          chatId={parentChat.id}
          onOpenChange={setChannelSettingsOpen}
          open={channelSettingsOpen}
          title={parentChat.title}
        />
      ) : null}
    </div>
  )
}
