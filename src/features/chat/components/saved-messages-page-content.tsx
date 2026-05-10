import { useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from '@tanstack/react-router'
import { Bookmark, GitBranch, Hash } from 'lucide-react'

import { MessageMarkdown } from '@/features/chat/components/message-markdown'
import {
  listSavedMessages,
  previewText,
  toggleSavedMessage,
  type SavedMessageWithContext,
} from '@/features/chat/repository'
import { cn } from '@/lib/utils'

const COLLAPSED_MAX_HEIGHT_PX = 240

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function threadLabel(saved: SavedMessageWithContext) {
  if (!saved.threadRootMessage) {
    return 'Untitled branch'
  }
  const text = previewText(saved.threadRootMessage.content)
  return text.length > 40 ? `${text.slice(0, 37)}...` : text || 'Untitled branch'
}

function SavedMessageCard({
  onJump,
  saved,
}: {
  onJump: () => void
  saved: SavedMessageWithContext
}) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const threadCrumb =
    saved.conversationType === 'thread' ? threadLabel(saved) : undefined

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) {
      return
    }

    setOverflowing(element.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 4)
  }, [saved.message.content])

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

  const handleCardClick = (target: EventTarget | null) => {
    if (target instanceof Element && target.closest('button, a')) {
      return
    }
    onJump()
  }

  return (
    <li
      className="group cursor-pointer rounded border border-line bg-surface px-4 py-3 transition hover:border-accent-border"
      onClick={(event) => handleCardClick(event.target)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        event.preventDefault()
        onJump()
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-meta text-ink-muted">
        <span className="inline-flex items-center gap-1 text-ink">
          <Hash className="size-3" />
          {saved.parentChat.title}
        </span>
        {threadCrumb ? (
          <>
            <span className="text-ink-dim">›</span>
            <span className="inline-flex items-center gap-1 text-accent">
              <GitBranch className="size-3" />
              {threadCrumb}
            </span>
          </>
        ) : null}
        <span className="text-ink-dim">·</span>
        <span>saved {formatTimestamp(saved.createdAt)}</span>
      </div>
      <div
        className={cn(
          'relative mt-2 w-full text-body leading-6 text-ink',
          !expanded && overflowing
            ? 'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-12 after:bg-gradient-to-t after:from-surface after:to-transparent'
            : '',
        )}
        ref={contentRef}
        style={{
          maxHeight: expanded ? undefined : `${COLLAPSED_MAX_HEIGHT_PX}px`,
          overflow: expanded ? undefined : 'hidden',
        }}
      >
        <MessageMarkdown content={saved.message.content || '(empty message)'} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {overflowing ? (
          <button
            className="rounded text-body font-semibold text-accent transition hover:underline"
            onClick={(event) => {
              stop(event)
              setExpanded((value) => !value)
            }}
            type="button"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : (
          <span />
        )}
        <button
          className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-meta text-ink-muted transition hover:bg-surface-muted hover:text-ink"
          onClick={(event) => {
            stop(event)
            void toggleSavedMessage(saved.messageId)
          }}
          type="button"
        >
          Remove
        </button>
      </div>
    </li>
  )
}

export function SavedMessagesPageContent() {
  const navigate = useNavigate()
  const savedMessages = useLiveQuery(
    () => listSavedMessages(),
    [],
    [] as SavedMessageWithContext[],
  )

  const openSaved = async (saved: SavedMessageWithContext) => {
    if (saved.conversationType === 'thread') {
      await navigate({
        to: '/chat/$chatId/thread/$threadId',
        params: { chatId: saved.parentChatId, threadId: saved.conversationId },
        hash: `message-row-${saved.messageId}`,
      })
      return
    }

    await navigate({
      to: '/chat/$chatId',
      params: { chatId: saved.parentChatId },
      hash: `message-row-${saved.messageId}`,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line bg-surface px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <Bookmark className="size-4 text-accent" />
          <h1 className="text-heading font-bold tracking-tight text-ink">Saved for later</h1>
          <span className="rounded-full border border-line bg-surface-muted px-2 font-mono text-meta text-ink-muted">
            {savedMessages.length}
          </span>
        </div>
        <p className="mt-1 text-small text-ink-muted">
          A private collection across every chat. Click a saved entry to jump back to its
          original message.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4">
        {savedMessages.length === 0 ? (
          <div className="mx-auto max-w-md rounded border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center text-small leading-6 text-ink-muted">
            No saved messages yet. Use the bookmark action on any message to keep it here.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {savedMessages.map((saved) => (
              <SavedMessageCard
                key={saved.id}
                onJump={() => void openSaved(saved)}
                saved={saved}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
