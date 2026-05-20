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
import { getAgent, listAgents } from '@/features/agents/agents-repository'
import { ChannelSettingsDialog } from '@/features/chat/components/channel-settings-dialog'
import {
  MentionAutocomplete,
  type MentionAutocompleteHandle,
} from '@/features/chat/components/mention-autocomplete'
import {
  applyMentionInsertion,
  detectMentionQuery,
  type MentionQuery,
} from '@/features/chat/components/mention-autocomplete-engine'
import { MessageMarkdown } from '@/features/chat/components/message-markdown'
import type { Agent, ChannelParticipant, Turn } from '@/features/chat/domain'
import {
  getActiveTurnForParentChat,
  interruptActiveTurn,
} from '@/features/chat/turn-lifecycle'
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
  loadConversationPanes,
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
  type ConversationPanes,
  type ConversationThread,
  type ParentChat,
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

// Stable identity for the scroll pane's content so it knows when to follow a
// growing tail of messages. Each entry contributes id/length/status — enough
// to detect both new messages and in-place streaming growth.
function scrollContentKeyFor(messages: ChatMessage[]) {
  return messages
    .map((message) => `${message.id}:${message.content.length}:${message.status}`)
    .join('|')
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

// Per-participant stats for the context meter. In a 1:1 (DM or model-DM)
// there's a single entry; in a channel every agent that has spoken gets its
// own entry so the meter can surface the agent closest to its limit and the
// total cost across all participants.
interface MeterEntry {
  key: string
  displayName: string
  agentId?: string
  usage: ProviderUsage
  totalCostUsd: number
}

function buildMeterEntries(
  messages: ChatMessage[],
  availableModels?: EffectiveModel[],
): MeterEntry[] {
  const byKey = new Map<string, { entry: MeterEntry; latestCreatedAt: number }>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (!message.providerUsage) continue
    // Group by agentId (channel/agent-DM) or by model identity (model-DM).
    const key =
      message.agentId ??
      (message.model
        ? `model:${message.model.providerKind}:${message.model.providerModelId}`
        : 'unknown')
    const enriched = enrichUsageWithCatalog(
      message.providerUsage,
      message.model,
      availableModels,
    )
    const cost = message.providerUsage.costCredits ?? 0
    const existing = byKey.get(key)
    if (existing) {
      existing.entry.totalCostUsd += cost
      if (message.createdAt >= existing.latestCreatedAt) {
        // Take the latest snapshot for usage AND displayName so an agent that
        // was renamed or had its model swapped surfaces with current identity,
        // not its first-message snapshot from earlier in the conversation.
        existing.entry.usage = enriched
        existing.entry.displayName = assistantDisplayName(message)
        existing.latestCreatedAt = message.createdAt
      }
    } else {
      byKey.set(key, {
        entry: {
          key,
          displayName: assistantDisplayName(message),
          agentId: message.agentId ?? undefined,
          usage: enriched,
          totalCostUsd: cost,
        },
        latestCreatedAt: message.createdAt,
      })
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.latestCreatedAt - a.latestCreatedAt)
    .map((wrapped) => wrapped.entry)
}

function buildMeterEntryLookup(entries: MeterEntry[]) {
  const byAgentId = new Map<string, MeterEntry>()
  for (const entry of entries) {
    if (entry.agentId) byAgentId.set(entry.agentId, entry)
  }
  return (agentId?: string | null): MeterEntry | undefined =>
    agentId ? byAgentId.get(agentId) : undefined
}

function assistantDisplayName(message: ChatMessage): string {
  if (message.agentSnapshot?.displayName) return message.agentSnapshot.displayName
  if (message.model?.providerModelId) return message.model.providerModelId
  return 'assistant'
}

function enrichUsageWithCatalog(
  usage: ProviderUsage,
  model: ChatMessage['model'],
  availableModels?: EffectiveModel[],
): ProviderUsage {
  if (typeof usage.contextWindowTokens === 'number') return usage
  if (!model || !availableModels) return usage
  const match = availableModels.find(
    (entry) =>
      entry.providerKind === model.providerKind &&
      entry.providerModelId === model.providerModelId,
  )
  if (typeof match?.contextLength !== 'number') return usage
  return { ...usage, contextWindowTokens: match.contextLength }
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

// OpenRouter reports usage.cost in dollars (their credits map 1:1 to USD).
// Render with sig-fig-aware precision so a 4-cent call doesn't show as
// "0.0427389" and a sub-cent call doesn't claim more precision than matters.
function formatCostUsd(usd: number) {
  if (usd === 0) return '$0'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 0.01) return `$${usd.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
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

function ThreadRootPreview({
  avatarDataUrl,
  message,
  replyCount,
  userName,
}: {
  avatarDataUrl?: string
  message: ChatMessage
  replyCount: number
  userName: string
}) {
  const replyLabel =
    replyCount === 0
      ? 'No replies yet'
      : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`

  return (
    <div>
      <article className="flex gap-3 px-4 py-2">
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
            {message.editedAt ? (
              <span className="font-mono text-meta text-ink-dim">(edited)</span>
            ) : null}
          </div>
          <MessageText content={message.content} streaming={message.status === 'streaming'} />
        </div>
      </article>
      <div className="flex items-center gap-3 px-4 pb-1.5 pt-1 font-mono text-meta text-ink-muted">
        <span className="whitespace-nowrap">{replyLabel}</span>
        <span className="h-px flex-1 bg-line" />
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
  meterEntry,
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
  meterEntry?: MeterEntry
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
            meterEntry ? (
              <MeterHoverCard entry={meterEntry}>
                <span className="rounded border border-line bg-surface-muted px-1 py-px font-mono text-meta text-ink-muted">
                  {modelShortName(message.model)}
                </span>
              </MeterHoverCard>
            ) : (
              <span className="rounded border border-line bg-surface-muted px-1 py-px font-mono text-meta text-ink-muted">
                {modelShortName(message.model)}
              </span>
            )
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


interface ComputedMeterStats {
  usedTokens?: number
  windowTokens?: number
  remainingTokens?: number
  percentLeft?: number
  percentUsed?: number
}

function computeMeterStats(usage: ProviderUsage): ComputedMeterStats {
  const usedTokens = tokenCount(usage)
  const windowTokens = usage.contextWindowTokens
  const remainingTokens =
    usage.remainingTokens ??
    (typeof windowTokens === 'number' && typeof usedTokens === 'number'
      ? Math.max(windowTokens - usedTokens, 0)
      : undefined)
  // Honest rounding: only show 100% when nothing has been used, and only
  // show 0% when the window is fully spent. Anything in between clamps to
  // [1, 99] so a single token can't read as "empty" or "full".
  const percentLeft =
    typeof windowTokens === 'number' &&
    typeof usedTokens === 'number' &&
    windowTokens > 0
      ? usedTokens <= 0
        ? 100
        : usedTokens >= windowTokens
          ? 0
          : Math.min(99, Math.max(1, Math.round(((windowTokens - usedTokens) / windowTokens) * 100)))
      : undefined
  return {
    usedTokens,
    windowTokens,
    remainingTokens,
    percentLeft,
    percentUsed: typeof percentLeft === 'number' ? 100 - percentLeft : undefined,
  }
}

function detailRowsForEntry(entry: MeterEntry): Array<{ label: string; value: string }> {
  const stats = computeMeterStats(entry.usage)
  const usage = entry.usage
  return [
    typeof stats.percentLeft === 'number'
      ? { label: 'Context', value: `${stats.percentLeft}% left · ${stats.percentUsed}% used` }
      : null,
    typeof stats.remainingTokens === 'number' && typeof stats.windowTokens === 'number'
      ? {
          label: 'Window',
          value: `${formatTokenCount(stats.remainingTokens)} of ${formatTokenCount(stats.windowTokens)} left`,
        }
      : typeof stats.remainingTokens === 'number'
        ? { label: 'Remaining', value: formatTokenCount(stats.remainingTokens) }
        : null,
    typeof usage.promptTokens === 'number'
      ? { label: 'Input', value: `${formatTokenCount(usage.promptTokens)} tokens` }
      : null,
    typeof usage.completionTokens === 'number'
      ? { label: 'Output', value: `${formatTokenCount(usage.completionTokens)} tokens` }
      : null,
    typeof usage.totalTokens === 'number'
      ? { label: 'Total', value: `${formatTokenCount(usage.totalTokens)} tokens` }
      : null,
    typeof usage.reasoningTokens === 'number' && usage.reasoningTokens > 0
      ? { label: 'Reasoning', value: `${formatTokenCount(usage.reasoningTokens)} tokens` }
      : null,
    typeof usage.cachedTokens === 'number' && usage.cachedTokens > 0
      ? { label: 'Cached', value: `${formatTokenCount(usage.cachedTokens)} tokens` }
      : null,
    entry.totalCostUsd > 0
      ? { label: 'Cost (so far)', value: formatCostUsd(entry.totalCostUsd) }
      : typeof usage.costCredits === 'number'
        ? { label: 'Cost', value: formatCostUsd(usage.costCredits) }
        : null,
    usage.provider ? { label: 'Provider', value: usage.provider } : null,
  ].filter((row): row is { label: string; value: string } => row !== null)
}

// Reusable hover popover anchored to a trigger element. Uses fixed positioning
// so it escapes composer's overflow-hidden ancestor; coords are recomputed on
// each open from the trigger's bounding box.
function useHoverAnchor() {
  const triggerRef = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const open = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
  }
  const close = () => setPosition(null)
  return { triggerRef, position, open, close }
}

function HoverPopover({
  position,
  children,
}: {
  position: { left: number; bottom: number }
  children: ReactNode
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-max min-w-[14rem] max-w-sm rounded-xs border border-line-strong bg-surface px-2 py-1.5 font-mono text-meta text-ink shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
      style={{ left: position.left, bottom: position.bottom }}
    >
      {children}
    </div>
  )
}

function EntryDetailList({ entry }: { entry: MeterEntry }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {detailRowsForEntry(entry).map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-ink-dim">{row.label}</dt>
          <dd className="text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ContextMeter({ compact, entries = [] }: { compact?: boolean; entries?: MeterEntry[] }) {
  const { triggerRef, position, open, close } = useHoverAnchor()

  const hasEntries = entries.length > 0
  // For the chip stat: in a 1:1 conversation use the sole entry; in a channel
  // surface the agent closest to its limit (lowest %-left) so the meter warns
  // about the bottleneck rather than averaging it away.
  const entryStats = entries.map((entry) => ({ entry, stats: computeMeterStats(entry.usage) }))
  const pressured = entryStats.reduce<typeof entryStats[number] | undefined>((worst, current) => {
    if (typeof current.stats.percentLeft !== 'number') return worst
    if (!worst || typeof worst.stats.percentLeft !== 'number') return current
    return current.stats.percentLeft < worst.stats.percentLeft ? current : worst
  }, undefined)
  const headline = pressured ?? entryStats[0]
  const percentLeft = headline?.stats.percentLeft
  const percentUsed = headline?.stats.percentUsed
  const usedTokens = headline?.stats.usedTokens
  const remainingTokens = headline?.stats.remainingTokens
  const windowTokens = headline?.stats.windowTokens
  const circleProgress = percentUsed ?? 0
  const totalCostUsd = entries.reduce((sum, entry) => sum + entry.totalCostUsd, 0)
  const isMulti = entries.length > 1

  const primary =
    typeof percentLeft === 'number'
      ? `${percentLeft}% left`
      : hasEntries
        ? `${formatTokenCount(usedTokens)} used`
        : 'context'
  const inputOutputLabel = headline
    ? typeof headline.entry.usage.promptTokens === 'number' ||
      typeof headline.entry.usage.completionTokens === 'number'
      ? `${formatTokenCount(headline.entry.usage.promptTokens)} in · ${formatTokenCount(headline.entry.usage.completionTokens)} out`
      : headline.entry.usage.provider
    : undefined
  const scaleLabel =
    typeof remainingTokens === 'number' && typeof windowTokens === 'number'
      ? `${formatTokenCount(remainingTokens)} / ${formatTokenCount(windowTokens)}`
      : typeof remainingTokens === 'number'
        ? `${formatTokenCount(remainingTokens)} left`
        : undefined
  // Channel chip stays quiet: just the bottleneck % is shown inline. Per-agent
  // depth (tokens, cost, provider) lives on each agent's name hover.
  const secondary = isMulti
    ? null
    : (scaleLabel ?? (compact && hasEntries ? headline?.entry.usage.provider : inputOutputLabel || 'after reply'))

  return (
    <>
      <div
        ref={(node) => {
          triggerRef.current = node
        }}
        className="inline-flex h-[22px] items-center gap-1.5 rounded-xs border border-line bg-surface-muted px-1.5 font-mono text-meta text-ink-muted"
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        tabIndex={0}
      >
        <span
          className="relative size-3 rounded-full border border-line"
          style={{
            background:
              hasEntries && typeof percentUsed === 'number'
                ? `conic-gradient(var(--send) ${circleProgress}%, color-mix(in srgb, var(--ink) 8%, transparent) 0)`
                : undefined,
          }}
        />
        <strong className="text-ink">{primary}</strong>
        {secondary ? (
          <>
            <span className="text-ink-dim">·</span>
            <span>{secondary}</span>
          </>
        ) : null}
      </div>
      {position ? (
        <HoverPopover position={position}>
          {!hasEntries ? (
            <p className="text-ink-dim">Provider token usage appears after a completed reply.</p>
          ) : isMulti ? (
            <div className="grid gap-1">
              <p className="text-ink-dim">Hover a model chip for tokens &amp; cost.</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {entryStats.map(({ entry, stats }) => (
                  <div key={entry.key} className="contents">
                    <dt className="truncate text-ink">{entry.displayName}</dt>
                    <dd className="text-right text-ink-dim">
                      {typeof stats.percentLeft === 'number'
                        ? `${stats.percentLeft}% left`
                        : 'no window'}
                    </dd>
                  </div>
                ))}
              </dl>
              {totalCostUsd > 0 ? (
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1 text-ink">
                  <span className="text-ink-dim">Total cost</span>
                  <span className="font-semibold">{formatCostUsd(totalCostUsd)}</span>
                </div>
              ) : null}
            </div>
          ) : headline ? (
            <EntryDetailList entry={headline.entry} />
          ) : null}
        </HoverPopover>
      ) : null}
    </>
  )
}

// Hover card around an assistant message's model chip. The model is the thing
// whose context window and cost the meter describes, so attaching there reads
// more naturally than putting it on the agent's display name.
function MeterHoverCard({
  children,
  entry,
}: {
  children: ReactNode
  entry?: MeterEntry
}) {
  const { triggerRef, position, open, close } = useHoverAnchor()
  if (!entry) {
    return <>{children}</>
  }
  const stats = computeMeterStats(entry.usage)
  return (
    <>
      <span
        ref={(node) => {
          triggerRef.current = node
        }}
        className="cursor-help"
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        tabIndex={0}
      >
        {children}
      </span>
      {position ? (
        <HoverPopover position={position}>
          <div className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3 text-ink">
              <span className="truncate font-semibold">{entry.displayName}</span>
              <span className="shrink-0 text-ink-dim">
                {typeof stats.percentLeft === 'number'
                  ? `${stats.percentLeft}% left`
                  : 'no window'}
              </span>
            </div>
            <EntryDetailList entry={entry} />
          </div>
        </HoverPopover>
      ) : null}
    </>
  )
}

// Debounce persisting the draft to IndexedDB. The textarea is uncontrolled
// from Dexie's perspective: typing only mutates local React state, and writes
// land on a timer + final flushes on submit, blur, and unmount. Without this,
// every keystroke fired a Dexie update → useLiveQuery(loadConversationPanes)
// re-ran → the whole workspace (every MessageBlock and sibling live query)
// re-rendered, making typing visibly slow on busy conversations.
const DRAFT_PERSIST_DEBOUNCE_MS = 400

function ConversationComposer({
  className,
  disabled,
  initialValue,
  onPersist,
  onSubmit,
  placeholder,
  submitDisabled,
  tone,
  meterEntries,
}: {
  className?: string
  disabled?: boolean
  initialValue: string
  onPersist: (value: string) => void
  onSubmit: (value: string) => boolean | Promise<boolean>
  placeholder: string
  submitDisabled?: boolean
  tone: ComposerTone
  meterEntries?: MeterEntry[]
}) {
  const cannotSubmit = disabled || submitDisabled
  const formRef = useRef<HTMLFormElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [value, setValue] = useState(initialValue)

  // Refs let the debounce timer and unmount cleanup read the latest values
  // without rebinding the timer or effect on every keystroke.
  const valueRef = useRef(value)
  const persistedRef = useRef(initialValue)
  const persistRef = useRef(onPersist)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    valueRef.current = value
    persistRef.current = onPersist
  })

  const flushPersist = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (persistedRef.current === valueRef.current) return
    persistedRef.current = valueRef.current
    persistRef.current(valueRef.current)
  }

  const schedulePersist = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (persistedRef.current === valueRef.current) return
      persistedRef.current = valueRef.current
      persistRef.current(valueRef.current)
    }, DRAFT_PERSIST_DEBOUNCE_MS)
  }

  // Flush any pending draft on unmount so chat/thread switches and full
  // tab teardowns don't drop in-flight characters.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (persistedRef.current !== valueRef.current) {
        persistedRef.current = valueRef.current
        persistRef.current(valueRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    const nextHeight = Math.min(Math.max(element.scrollHeight, 42), 180)
    element.style.height = `${nextHeight}px`
  }, [value])

  // Mention autocomplete — load every defined agent so the popup can
  // suggest beyond just the channel's current participants. Filtering and
  // ranking happens inside the popup.
  const allAgents = useLiveQuery(() => listAgents(), [], [] as Agent[])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const autocompleteRef = useRef<MentionAutocompleteHandle | null>(null)

  const refreshMentionQuery = () => {
    const element = textareaRef.current
    if (!element) {
      setMentionQuery(null)
      return
    }
    const caret = element.selectionStart ?? element.value.length
    setMentionQuery(detectMentionQuery(element.value, caret))
  }

  const handleSelectAgent = (agent: Agent) => {
    const element = textareaRef.current
    if (!element) return
    const caret = element.selectionStart ?? element.value.length
    const { value: nextValue, caret: nextCaret } = applyMentionInsertion(
      element.value,
      caret,
      agent,
    )
    setValue(nextValue)
    schedulePersist()
    setMentionQuery(null)
    // Restore caret position after React applies the new value.
    queueMicrotask(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (cannotSubmit) return
    const current = valueRef.current
    if (!current.trim()) return
    // Cancel the pending debounce: we're about to send, so a stale write
    // racing against markParentDraftSent (which clears the draft) would
    // resurrect already-sent text in the row.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const restoreSubmittedValue = () => {
      if (valueRef.current !== '') return
      valueRef.current = current
      persistedRef.current = current
      setValue(current)
      persistRef.current(current)
    }

    // Clear immediately so the user can begin composing the next prompt while
    // the turn streams. Submission is still single-flight; queueing is later.
    valueRef.current = ''
    persistedRef.current = ''
    setMentionQuery(null)
    setValue('')
    persistRef.current('')

    try {
      const succeeded = await onSubmit(current)
      if (!succeeded) {
        restoreSubmittedValue()
      }
    } catch {
      restoreSubmittedValue()
    }
  }

  return (
    <form className={cn('relative px-5 pb-3.5 pt-1.5', className)} onSubmit={handleFormSubmit} ref={formRef}>
      <MentionAutocomplete
        agents={allAgents}
        onSelect={handleSelectAgent}
        query={mentionQuery}
        ref={autocompleteRef}
      />
      <div className="overflow-hidden rounded-md border border-line-strong bg-surface">
        <div className="flex items-start gap-1.5 px-3 pt-2.5 pb-1">
          <span className="mt-px font-mono text-body text-accent">›</span>
          <textarea
            className="min-h-[22px] flex-1 resize-none border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-dim"
            disabled={disabled}
            onBlur={() => {
              setMentionQuery(null)
              flushPersist()
            }}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setValue(event.target.value)
              schedulePersist()
              // Defer the caret read until after onChange-triggered renders
              // so the query reflects the new value, not the previous one.
              queueMicrotask(refreshMentionQuery)
            }}
            onClick={refreshMentionQuery}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              const popup = autocompleteRef.current
              if (mentionQuery && popup) {
                if (event.key === 'ArrowDown' && popup.next()) {
                  event.preventDefault()
                  return
                }
                if (event.key === 'ArrowUp' && popup.prev()) {
                  event.preventDefault()
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  if (popup.accept()) {
                    event.preventDefault()
                    return
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMentionQuery(null)
                  return
                }
              }

              if (event.key !== 'Enter' || !event.metaKey || cannotSubmit) {
                return
              }

              event.preventDefault()
              formRef.current?.requestSubmit()
            }}
            onKeyUp={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              // Arrow keys, Home/End, and clicks can move the caret without
              // changing the value — refresh the query state when that happens.
              if (
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight' ||
                event.key === 'Home' ||
                event.key === 'End'
              ) {
                refreshMentionQuery()
              }
            }}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            value={value}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-line px-1.5 py-1 pl-2">
          <ContextMeter compact={tone === 'thread'} entries={meterEntries} />
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

function ModelChip({
  availableModels,
  connections,
  disabled,
  model,
  onModelChange,
}: {
  availableModels: EffectiveModel[]
  connections: ProviderConnection[]
  disabled?: boolean
  model: string
  onModelChange: (value: string) => void
}) {
  return (
    <MiniModelSelect
      availableModels={availableModels}
      connections={connections}
      disabled={disabled}
      fallbackLabel={(id) => shortNameForModelId(id) ?? id}
      onChange={onModelChange}
      value={model}
    />
  )
}

function AgentIdentityChip({
  agentId,
  agentName,
  modelName,
}: {
  agentId: string
  agentName: string
  modelName?: string
}) {
  return (
    <Link
      className="inline-flex h-[22px] min-w-0 items-center gap-1.5 rounded-xs border border-line bg-surface-muted px-1.5 font-mono text-meta text-ink transition hover:bg-canvas"
      title={`Edit ${agentName}`}
      to="/settings/agents"
    >
      <AgentDot agentId={agentId} displayName={agentName} size="sm" />
      <span className="truncate font-semibold">{agentName}</span>
      {modelName ? (
        <>
          <span className="text-ink-dim">·</span>
          <span className="text-ink-dim">{modelName}</span>
        </>
      ) : null}
    </Link>
  )
}

function ChannelHeader({
  activeTab,
  branchCount,
  identityChip,
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
  // Kind-specific identity affordance rendered next to the title:
  //   - model-DM: model picker chip (selector lives here, not in the composer)
  //   - agent-DM: a static agent name + model badge linking to the agent edit
  //   - channel: omitted (channel settings entry point is the toolbar button)
  identityChip?: React.ReactNode
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
        {identityChip ? <div className="hidden min-w-0 sm:flex">{identityChip}</div> : null}
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

function TurnInProgressBanner({
  isChannel,
  onCancel,
}: {
  isChannel: boolean
  onCancel: () => void
}) {
  // A thin status strip above the composer — quiet by default, with a
  // pulsing dot to signal motion and a low-contrast Stop control. The
  // original full-width accent banner was too loud for a state the user
  // can already infer from streaming message text. Mounted only while a
  // turn for this surface is `status='active'`; Stop maps to
  // `interruptActiveTurn`, which closes the turn with `user-interrupt`
  // and aborts the registered stream controller.
  return (
    <div className="mx-5 mb-0.5 mt-1.5 flex items-center gap-2 font-mono text-meta text-ink-muted">
      <span aria-hidden className="relative inline-flex size-1.5 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {isChannel ? 'agents responding' : 'streaming response'}
      </span>
      <button
        aria-label="Stop response"
        className="inline-flex shrink-0 items-center gap-1 rounded-xs border border-transparent px-1.5 py-0.5 uppercase tracking-wide text-ink-dim transition hover:border-line hover:text-ink"
        onClick={onCancel}
        type="button"
      >
        Stop
      </button>
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

// The "Branch" title bar shared by <ThreadPane> and <MissingBranchPlaceholder>.
// Both surfaces label themselves the same way; only the trailing controls
// (actions menu, close button, fork meta) differ. At depth ≥ 2 a faint
// `L{depth}` chip hints at how nested the user is — quiet enough not to
// compete with the breadcrumb, present enough to read at a glance.
function ThreadPaneTitleBar({ children, depth }: { children?: ReactNode; depth?: number }) {
  return (
    <div className="flex items-center gap-2">
      <GitBranch className="size-3.5 shrink-0 text-accent" />
      <h2 className="text-heading font-bold tracking-tight text-ink">Branch</h2>
      {depth && depth >= 2 ? (
        <span
          className="font-mono text-meta font-semibold text-ink-dim"
          title={`Nested ${depth} levels deep`}
        >
          L{depth}
        </span>
      ) : null}
      <div className="min-w-0 flex-1" />
      {children}
    </div>
  )
}

function ThreadPaneCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      aria-label="Close branch"
      className="rounded p-0.5 leading-none text-ink-muted transition hover:text-ink"
      onClick={onClose}
      type="button"
    >
      <X className="size-4" />
    </button>
  )
}

// Rendered in place of <ThreadPane> when the URL names a thread we can't
// resolve locally. Preserves the disabled-composer affordance so users see
// a recognizable thread surface and can dismiss back to the channel.
function MissingBranchPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-surface">
      <header className="border-b border-line px-3.5 pb-2 pt-2.5">
        <ThreadPaneTitleBar>
          <ThreadPaneCloseButton onClose={onClose} />
        </ThreadPaneTitleBar>
      </header>
      <div className="min-h-0 overflow-y-auto py-2">
        <EmptyState>This branch does not exist in local storage.</EmptyState>
      </div>
      <ConversationComposer
        disabled
        initialValue=""
        onPersist={() => undefined}
        onSubmit={() => false}
        placeholder="Continue this branch, or /branch to fork again..."
        submitDisabled
        tone="thread"
      />
    </div>
  )
}

type ThreadPaneTone = 'main' | 'side'

// One thread surface — header, root preview, message list, and composer.
// Reused for the right-side aside (tone='side') and, at depth ≥ 2, for the
// main column (tone='main'). The two tones differ only in cosmetics (close
// button, message padding, header chrome); all data flow is identical.
function ThreadPane({
  activeTurn,
  availableModels,
  avatarDataUrl,
  initialDraft,
  error,
  hasUsableProvider,
  messages,
  onCancelTurn,
  onClose,
  onDelete,
  onPersistDraft,
  onModelChange,
  onOpenChildThread,
  onSubmit,
  onTogglePin,
  onToggleSaved,
  pinnedMessageIds,
  providers,
  refToPickerValue,
  rootChat,
  rootMessage,
  savedMessageIds,
  scrollContentKey,
  sending,
  showModelPicker,
  thread,
  tone,
  userName,
  meterEntries,
}: {
  activeTurn?: Turn
  availableModels: EffectiveModel[]
  avatarDataUrl?: string
  initialDraft: string
  error: string | null
  hasUsableProvider: boolean
  messages: ChatMessage[]
  onCancelTurn: () => void
  onClose?: () => void
  onDelete: () => void | Promise<void>
  onPersistDraft: (value: string) => void
  onModelChange: (value: string) => void
  onOpenChildThread: (messageId: string) => void
  onSubmit: (value: string) => boolean | Promise<boolean>
  onTogglePin: (messageId: string) => Promise<void>
  onToggleSaved: (messageId: string) => Promise<void>
  pinnedMessageIds: Set<string>
  providers: ProviderConnection[]
  refToPickerValue: (ref: ModelRef | null | undefined) => string
  rootChat: ParentChat
  rootMessage: ChatMessage
  savedMessageIds: Set<string>
  scrollContentKey: string
  sending: boolean
  showModelPicker: boolean
  thread: ConversationThread
  tone: ThreadPaneTone
  userName: string
  meterEntries?: MeterEntry[]
}) {
  const archived = Boolean(rootChat.archivedAt)
  // Active-turn banner is scoped per-conversation: only show this pane's
  // banner if the active turn is the one streaming into this thread.
  const turnInThisThread =
    activeTurn?.conversationType === 'thread' && activeTurn.conversationId === thread.id
  const meterLookup = buildMeterEntryLookup(meterEntries ?? [])

  return (
    <div
      className={cn(
        'grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-surface',
      )}
    >
      <header className="border-b border-line px-3.5 pb-2 pt-2.5">
        <ThreadPaneTitleBar depth={thread.depth}>
          <ThreadActionsMenu onDelete={onDelete} />
          {onClose ? <ThreadPaneCloseButton onClose={onClose} /> : null}
        </ThreadPaneTitleBar>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-meta text-ink-muted">
          <span>
            fork: <span className="text-ink">{formatTime(rootMessage.createdAt)}</span>
          </span>
          <span>·</span>
          <span>{messages.length} msgs</span>
          {/* Model picker for model-DM threads only. Agent-DM and channel
              threads draw their model(s) from the agent definition(s) and
              do not expose a per-thread override. */}
          {showModelPicker ? (
            <>
              <span>·</span>
              <ModelChip
                availableModels={availableModels}
                connections={providers}
                disabled={archived}
                model={refToPickerValue(thread.model ?? rootChat.model)}
                onModelChange={onModelChange}
              />
            </>
          ) : null}
        </div>
      </header>

      <SmartMessageScrollPane
        className="min-h-0 overflow-y-auto py-2"
        contentKey={scrollContentKey}
        resetKey={thread.id}
      >
        {error ? <EmptyState>{error}</EmptyState> : null}

        <ThreadRootPreview
          avatarDataUrl={avatarDataUrl}
          message={rootMessage}
          replyCount={messages.length}
          userName={userName}
        />

        {messages.length === 0 ? (
          <EmptyState>
            No messages in this branch yet. Continue here to keep the side discussion separate from the channel.
          </EmptyState>
        ) : null}

        {messages.map((message) => (
          <MessageBlock
            avatarDataUrl={avatarDataUrl}
            active={pinnedMessageIds.has(message.id)}
            compact={tone === 'side'}
            isPinned={pinnedMessageIds.has(message.id)}
            isSaved={savedMessageIds.has(message.id)}
            key={message.id}
            message={message}
            meterEntry={meterLookup(message.agentId)}
            onOpenThread={onOpenChildThread}
            onTogglePin={onTogglePin}
            onToggleSaved={onToggleSaved}
            userName={userName}
          />
        ))}
      </SmartMessageScrollPane>

      <div>
        {hasUsableProvider ? null : <ProviderConnectBanner />}
        {turnInThisThread ? (
          <TurnInProgressBanner
            isChannel={rootChat.kind === 'channel'}
            onCancel={onCancelTurn}
          />
        ) : null}
        <ConversationComposer
          disabled={archived}
          initialValue={initialDraft}
          onPersist={onPersistDraft}
          onSubmit={onSubmit}
          placeholder="Continue this branch, or /branch to fork again..."
          submitDisabled={!hasUsableProvider || sending || turnInThisThread}
          tone="thread"
          meterEntries={meterEntries}
        />
      </div>
    </div>
  )
}

export function ParentChatWorkspace({ chatId, threadId }: ParentChatWorkspaceProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [parentError, setParentError] = useState<string | null>(null)
  // One error string per visible thread surface keyed by thread id. At depth
  // ≥ 2 we render two thread panes (main + side) and each can fail
  // independently, so a single shared `threadError` would clobber feedback.
  const [threadErrors, setThreadErrors] = useState<Record<string, string | null>>({})
  const [sendingParent, setSendingParent] = useState(false)
  const [sendingThreadId, setSendingThreadId] = useState<string | null>(null)
  const [parentTab, setParentTab] = useState<ParentTab>('messages')
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false)
  const pendingMessageJumpRef = useRef<string | null>(null)

  // Single source of truth for what each column should render. `main` is the
  // root channel at depth 0/1 and the focused branch's parent thread at
  // depth ≥ 2; `side` is the focused branch when threadId is set.
  const panes = useLiveQuery(
    () => loadConversationPanes(chatId, threadId),
    [chatId, threadId],
    undefined as ConversationPanes | undefined,
  )
  const parentChat = panes?.rootChat
  const mainView = panes?.main
  const sideView = panes?.side
  const mainThread = mainView?.kind === 'thread' ? mainView : undefined
  // Agent-DM identity is rendered in the header as a passive chip. Look up
  // the bound agent so its current display name (not the snapshot frozen on
  // each message) drives the chip — keeps it consistent with /settings/agents
  // edits without rewriting message history.
  const boundAgent = useLiveQuery(
    () =>
      parentChat?.kind === 'dm' && parentChat.agentId
        ? getAgent(parentChat.agentId)
        : Promise.resolve(undefined),
    [parentChat?.id, parentChat?.kind, parentChat?.agentId],
    undefined as import('@/features/chat/domain').Agent | undefined,
  )
  const channelParticipants = useLiveQuery(
    () =>
      parentChat?.kind === 'channel'
        ? listChannelParticipants(parentChat.id)
        : Promise.resolve([] as ChannelParticipant[]),
    [parentChat?.id, parentChat?.kind],
    [] as ChannelParticipant[],
  )
  const activeTurn = useLiveQuery(
    () =>
      parentChat
        ? getActiveTurnForParentChat(parentChat.id)
        : Promise.resolve(undefined),
    [parentChat?.id],
    undefined as Turn | undefined,
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
  // Messages for the focused (side) branch — keyed off the URL param so the
  // query runs in parallel with `panes` rather than waiting for it to resolve.
  // The pane only renders these once `sideView` is also set, but starting
  // the fetch early avoids a render-pass gap where the pane is mounted with
  // an empty message list.
  const sideThreadMessages = useLiveQuery(
    async () => {
      if (!threadId) return []
      return db.messages
        .where('[conversationId+createdAt]')
        .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
        .sortBy('createdAt')
    },
    [threadId],
    [] as ChatMessage[],
  )
  // Messages for the parent-thread main pane (only used at depth ≥ 2).
  // Derived from panes — there's no URL slot for the parent thread, so we
  // accept the second-step latency here.
  const mainThreadId = mainThread?.thread.id
  const mainThreadMessages = useLiveQuery(
    async () => {
      if (!mainThreadId) return []
      return db.messages
        .where('[conversationId+createdAt]')
        .between([mainThreadId, Dexie.minKey], [mainThreadId, Dexie.maxKey])
        .sortBy('createdAt')
    },
    [mainThreadId],
    [] as ChatMessage[],
  )
  const ancestorChain = useLiveQuery(
    async () => (threadId ? getThreadAncestorChain(threadId) : []),
    [threadId],
    [] as ThreadAncestor[],
  )
  const parentScrollContentKey = scrollContentKeyFor(parentMessages)
  const parentPinnedScrollContentKey = parentPinnedMessages
    .map((pin) => `${pin.id}:${pin.message.id}:${pin.message.content.length}:${pin.message.status}`)
    .join('|')
  const userName = settings?.userName ?? DEFAULT_USER_NAME
  const avatarDataUrl = settings?.avatarDataUrl
  const parentPinnedMessageIds = new Set(parentPinnedMessages.map((pin) => pin.messageId))
  // Pinned messages are stored at the channel level; filter to the
  // conversation that owns each visible thread pane.
  const pinnedIdsForConversation = (conversationId: string) =>
    new Set(
      parentPinnedMessages
        .filter((pin) => pin.conversationId === conversationId)
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
  const parentMeterEntries = buildMeterEntries(parentMessages, availableModels)
  const parentMeterLookup = buildMeterEntryLookup(parentMeterEntries)
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
      mainThreadMessages.some((message) => message.id === pendingMessageId) ||
      sideThreadMessages.some((message) => message.id === pendingMessageId)

    if (!messageIsVisible) {
      return
    }

    pendingMessageJumpRef.current = null
    window.requestAnimationFrame(() => jumpToMessage(pendingMessageId))
  }, [parentMessages, mainThreadMessages, sideThreadMessages])

  if (!parentChat || !mainView) {
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

  const setThreadError = (threadIdToSet: string, message: string | null) => {
    setThreadErrors((current) => ({ ...current, [threadIdToSet]: message }))
  }

  const toggleParentPin = async (messageId: string) => {
    setParentError(null)
    try {
      await togglePinnedMessage(messageId)
    } catch (error) {
      setParentError(error instanceof Error ? error.message : 'Could not update pinned message.')
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

  // Pin/save toggles share identical error-routing shape — only the
  // underlying repo call and the fallback message differ. One factory keeps
  // both thread panes honest about which pane owns the error.
  const makeThreadActionToggler = (
    paneThreadId: string,
    action: (messageId: string) => Promise<unknown>,
    fallbackMessage: string,
  ) => async (messageId: string) => {
    setThreadError(paneThreadId, null)
    try {
      await action(messageId)
    } catch (error) {
      setThreadError(paneThreadId, error instanceof Error ? error.message : fallbackMessage)
    }
  }
  const makeThreadPinToggler = (paneThreadId: string) =>
    makeThreadActionToggler(paneThreadId, togglePinnedMessage, 'Could not update pinned message.')
  const makeThreadSavedToggler = (paneThreadId: string) =>
    makeThreadActionToggler(paneThreadId, toggleSavedMessage, 'Could not update saved message.')

  // Returns true when the send completed cleanly so the composer can clear
  // its local draft; false (or a thrown error captured here) keeps whatever
  // the user typed in place for retry.
  const handleParentSubmit = async (prompt: string): Promise<boolean> => {
    const trimmed = prompt.trim()
    if (!trimmed || sendingParent) {
      return false
    }

    setParentError(null)
    setSendingParent(true)

    try {
      await sendParentChatTurn(parentChat.id, trimmed)
      return true
    } catch (error) {
      setParentError(error instanceof Error ? error.message : 'Request failed.')
      return false
    } finally {
      setSendingParent(false)
    }
  }

  // One factory per thread surface; both visible thread panes (main at
  // depth ≥ 2, side whenever a branch is open) submit through the same code
  // path keyed by their own thread id.
  const makeThreadSubmitHandler = (thread: ConversationThread) =>
    async (prompt: string): Promise<boolean> => {
      const trimmed = prompt.trim()
      if (!trimmed || sendingThreadId === thread.id) {
        return false
      }

      setThreadError(thread.id, null)
      setSendingThreadId(thread.id)

      try {
        await sendThreadTurn(thread.id, trimmed)
        return true
      } catch (error) {
        setThreadError(thread.id, error instanceof Error ? error.message : 'Request failed.')
        return false
      } finally {
        setSendingThreadId((currentThreadId) =>
          currentThreadId === thread.id ? null : currentThreadId,
        )
      }
    }

  // Closing or deleting the focused branch pops up one level: at depth 1
  // back to the root channel, at depth ≥ 2 back to the focused branch's
  // immediate parent thread. Keeps "main = parent of side" as the user
  // walks out of nested branches.
  const popSideBranch = async () => {
    if (!sideView) return
    const parentThreadId = sideView.thread.parentThreadId
    if (parentThreadId) {
      await navigate({
        to: '/chat/$chatId/thread/$threadId',
        params: { chatId: parentChat.id, threadId: parentThreadId },
      })
      return
    }
    await navigate({ to: '/chat/$chatId', params: { chatId: parentChat.id } })
  }

  const deleteSideBranch = async () => {
    if (!sideView) return
    const messageCount = sideThreadMessages.length
    const confirmation =
      messageCount === 0
        ? 'Discard this empty branch?'
        : `Delete this branch and its ${messageCount} ${messageCount === 1 ? 'message' : 'messages'}? Nested branches are removed too.`
    if (!window.confirm(confirmation)) {
      return
    }

    setThreadError(sideView.thread.id, null)
    try {
      // Cancel any in-flight stream first so orchestrator chunks don't keep
      // writing into a now-deleted thread. The interrupt is scoped to the
      // root chat and is a no-op when nothing is active.
      await interruptActiveTurn(parentChat.id)
      await deleteThread(sideView.thread.id)
      await popSideBranch()
    } catch (error) {
      setThreadError(
        sideView.thread.id,
        error instanceof Error ? error.message : 'Could not delete branch.',
      )
    }
  }

  const showSecondColumn = Boolean(threadId)
  // Lineage breadcrumb spans both panes — its last segment is the side
  // pane's root, second-to-last (when present) is the main thread.
  const lineageActiveRoot = sideView?.rootMessage ?? mainThread?.rootMessage
  const lineageAncestors = ancestorChain

  return (
    <div
      className={cn(
        'grid h-full min-h-0 min-w-0 overflow-hidden',
        showSecondColumn
          ? 'xl:grid-cols-[minmax(0,1fr)_minmax(340px,40%)] 2xl:grid-cols-[minmax(0,1fr)_460px]'
          : 'grid-cols-1',
      )}
    >
      {mainView.kind === 'parent' ? (
        <section className={cn('min-w-0 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]', showSecondColumn ? 'hidden xl:grid' : '')}>
          <ChannelHeader
            activeTab={parentTab}
            branchCount={branchCount}
            identityChip={
              parentChat.kind === 'channel'
                ? undefined
                : parentChat.agentId && boundAgent
                  ? (
                    <AgentIdentityChip
                      agentId={boundAgent.id}
                      agentName={boundAgent.displayName}
                      modelName={modelShortName(boundAgent.model ?? null)}
                    />
                  )
                  : (
                    <ModelChip
                      availableModels={availableModels}
                      connections={providers}
                      disabled={Boolean(parentChat.archivedAt)}
                      model={refToPickerValue(parentChat.model)}
                      onModelChange={(model) =>
                        void setParentChatModel(parentChat.id, pickerValueToRef(model))
                      }
                    />
                  )
            }
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
            activeRoot={lineageActiveRoot}
            ancestors={lineageAncestors}
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
                    meterEntry={parentMeterLookup(pin.message.agentId)}
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
                  meterEntry={parentMeterLookup(message.agentId)}
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
            {/* Scope the banner to the parent surface — a thread-scoped turn
                has its own activity in the thread aside and shouldn't double
                up here. */}
            {activeTurn &&
            activeTurn.conversationType === 'parent' &&
            activeTurn.conversationId === parentChat.id ? (
              <TurnInProgressBanner
                isChannel={parentChat.kind === 'channel'}
                onCancel={() => void interruptActiveTurn(parentChat.id)}
              />
            ) : null}
            <ConversationComposer
              disabled={Boolean(parentChat.archivedAt)}
              initialValue={parentChat.draft}
              key={parentChat.id}
              onPersist={(value) => void saveParentDraft(parentChat.id, value)}
              onSubmit={handleParentSubmit}
              placeholder="Ask anything, or /branch to fork this convo..."
              submitDisabled={
                !hasUsableProvider ||
                sendingParent ||
                Boolean(
                  activeTurn &&
                    activeTurn.conversationType === 'parent' &&
                    activeTurn.conversationId === parentChat.id,
                )
              }
              tone="parent"
              meterEntries={parentMeterEntries}
            />
          </div>
        </section>
      ) : (
        // Depth ≥ 2: the main column shows the immediate parent thread of
        // the focused branch. LineageBar above the pane keeps the chain
        // back to the channel visible.
        <section className={cn('grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden', showSecondColumn ? 'hidden xl:grid' : '')}>
          <LineageBar
            activeRoot={lineageActiveRoot}
            ancestors={lineageAncestors}
            chatId={parentChat.id}
            parentTitle={parentChat.title}
          />
          <ThreadPane
            activeTurn={activeTurn}
            availableModels={availableModels}
            avatarDataUrl={avatarDataUrl}
            initialDraft={mainView.thread.draft}
            key={mainView.thread.id}
            error={threadErrors[mainView.thread.id] ?? null}
            hasUsableProvider={hasUsableProvider}
            messages={mainThreadMessages}
            onCancelTurn={() => void interruptActiveTurn(parentChat.id)}
            onDelete={async () => {
              // Deleting the main thread implicitly removes the side too
              // (cascade) — interrupt any active stream first so it can't
              // keep writing into a deleted thread, then navigate to the
              // main thread's parent so the user lands somewhere coherent.
              if (!window.confirm('Delete this branch? Nested branches are removed too.')) {
                return
              }
              setThreadError(mainView.thread.id, null)
              try {
                await interruptActiveTurn(parentChat.id)
                await deleteThread(mainView.thread.id)
                const parentOfMain = mainView.thread.parentThreadId
                await navigate(
                  parentOfMain
                    ? {
                        to: '/chat/$chatId/thread/$threadId',
                        params: { chatId: parentChat.id, threadId: parentOfMain },
                      }
                    : { to: '/chat/$chatId', params: { chatId: parentChat.id } },
                )
              } catch (error) {
                setThreadError(
                  mainView.thread.id,
                  error instanceof Error ? error.message : 'Could not delete branch.',
                )
              }
            }}
            onPersistDraft={(value) => void saveThreadDraft(mainView.thread.id, value)}
            onModelChange={(value) =>
              void setThreadModel(mainView.thread.id, pickerValueToRef(value))
            }
            onOpenChildThread={(messageId) => void openThreadForMessage(messageId)}
            onSubmit={makeThreadSubmitHandler(mainView.thread)}
            onTogglePin={makeThreadPinToggler(mainView.thread.id)}
            onToggleSaved={makeThreadSavedToggler(mainView.thread.id)}
            pinnedMessageIds={pinnedIdsForConversation(mainView.thread.id)}
            providers={providers}
            refToPickerValue={refToPickerValue}
            rootChat={parentChat}
            rootMessage={mainView.rootMessage}
            savedMessageIds={savedMessageIds}
            scrollContentKey={scrollContentKeyFor(mainThreadMessages)}
            sending={sendingThreadId === mainView.thread.id}
            showModelPicker={parentChat.kind === 'dm' && !parentChat.agentId}
            thread={mainView.thread}
            tone="main"
            meterEntries={buildMeterEntries(mainThreadMessages, availableModels)}
            userName={userName}
          />
        </section>
      )}

      {showSecondColumn ? (
        <aside className="grid min-h-0 min-w-0 overflow-hidden border-l border-line-strong bg-surface">
          {sideView ? (
            <ThreadPane
              activeTurn={activeTurn}
              availableModels={availableModels}
              avatarDataUrl={avatarDataUrl}
              initialDraft={sideView.thread.draft}
              key={sideView.thread.id}
              error={threadErrors[sideView.thread.id] ?? null}
              hasUsableProvider={hasUsableProvider}
              messages={sideThreadMessages}
              onCancelTurn={() => void interruptActiveTurn(parentChat.id)}
              onClose={() => void popSideBranch()}
              onDelete={deleteSideBranch}
              onPersistDraft={(value) => void saveThreadDraft(sideView.thread.id, value)}
              onModelChange={(value) =>
                void setThreadModel(sideView.thread.id, pickerValueToRef(value))
              }
              onOpenChildThread={(messageId) => void openThreadForMessage(messageId)}
              onSubmit={makeThreadSubmitHandler(sideView.thread)}
              onTogglePin={makeThreadPinToggler(sideView.thread.id)}
              onToggleSaved={makeThreadSavedToggler(sideView.thread.id)}
              pinnedMessageIds={pinnedIdsForConversation(sideView.thread.id)}
              providers={providers}
              refToPickerValue={refToPickerValue}
              rootChat={parentChat}
              rootMessage={sideView.rootMessage}
              savedMessageIds={savedMessageIds}
              scrollContentKey={scrollContentKeyFor(sideThreadMessages)}
              sending={sendingThreadId === sideView.thread.id}
              showModelPicker={parentChat.kind === 'dm' && !parentChat.agentId}
              thread={sideView.thread}
              tone="side"
              meterEntries={buildMeterEntries(sideThreadMessages, availableModels)}
              userName={userName}
            />
          ) : (
            <MissingBranchPlaceholder onClose={() => void popSideBranch()} />
          )}
        </aside>
      ) : null}

      {!showSecondColumn && parentMessages.length === 0 && mainView.kind === 'parent' ? (
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
