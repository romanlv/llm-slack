import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from '@tanstack/react-router'
import { Hash, MessagesSquare, Star } from 'lucide-react'

import {
  countStartedBranchesByParentChat,
  db,
  toggleStarParentChat,
  type ParentChat,
} from '@/features/chat/repository'
import { cn } from '@/lib/utils'

function formatUpdatedAt(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

export function ChatsPageContent() {
  const parentChats = useLiveQuery(
    () => db.parentChats.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as ParentChat[],
  )
  const threadCountByParentChat = useLiveQuery(
    () => countStartedBranchesByParentChat(),
    [],
    new Map<string, number>(),
  )

  const activeChats = parentChats.filter((chat) => !chat.archivedAt)
  const archivedChats = parentChats.filter((chat) => Boolean(chat.archivedAt))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line bg-surface px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <MessagesSquare className="size-4 text-accent" />
          <h1 className="text-heading font-bold tracking-tight text-ink">All conversations</h1>
          <span className="rounded-full border border-line bg-surface-muted px-2 font-mono text-meta text-ink-muted">
            {activeChats.length}
          </span>
        </div>
        <p className="mt-1 text-small text-ink-muted">
          Every conversation in this workspace. Star the ones you want pinned to the sidebar.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4">
        {activeChats.length === 0 ? (
          <div className="mx-auto max-w-md rounded border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center text-small leading-6 text-ink-muted">
            No conversations yet.
          </div>
        ) : (
          <ul className="flex flex-col">
            {activeChats.map((chat) => {
              const branchCount = threadCountByParentChat.get(chat.id) ?? 0
              const starred = Boolean(chat.starredAt)

              return (
                <li
                  className="group flex items-center gap-3 border-b border-line py-2"
                  key={chat.id}
                >
                  <button
                    aria-label={starred ? `Unstar ${chat.title}` : `Star ${chat.title}`}
                    aria-pressed={starred}
                    className={cn(
                      'rounded p-1 transition hover:bg-surface-muted',
                      starred ? 'text-yellow' : 'text-ink-dim hover:text-ink',
                    )}
                    onClick={() => void toggleStarParentChat(chat.id)}
                    type="button"
                  >
                    <Star
                      className={cn('size-4', starred ? 'fill-yellow' : '')}
                    />
                  </button>
                  <Link
                    className="flex min-w-0 flex-1 items-center gap-2 text-body text-ink transition hover:text-accent"
                    params={{ chatId: chat.id }}
                    to="/chat/$chatId"
                  >
                    <Hash className="size-3.5 shrink-0 text-ink-dim" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{chat.title}</span>
                    <span className="hidden font-mono text-meta text-ink-muted sm:inline">
                      {chat.lastActivityPreview || 'No messages yet.'}
                    </span>
                  </Link>
                  <span className="font-mono text-meta text-ink-dim">
                    {branchCount > 0 ? `↳${branchCount}` : '—'}
                  </span>
                  <span className="hidden w-28 text-right font-mono text-meta text-ink-dim sm:inline">
                    {formatUpdatedAt(chat.updatedAt)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {archivedChats.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-2 font-mono text-meta font-bold uppercase tracking-[0.08em] text-ink-muted">
              Archived
            </h2>
            <ul className="flex flex-col">
              {archivedChats.map((chat) => (
                <li
                  className="flex items-center gap-3 border-b border-line py-2 text-ink-muted"
                  key={chat.id}
                >
                  <Hash className="size-3.5 shrink-0 text-ink-dim" />
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                  <span className="font-mono text-meta text-ink-dim">archived</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
