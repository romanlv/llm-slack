import { useDeferredValue, useEffect, useState } from 'react'
import type { RefCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  ExternalLink,
  GitBranch,
  Hash,
  KeyRound,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  Settings2,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Menu, MenuItem } from '@/components/ui/menu'
import {
  archiveParentChat,
  countStartedBranchesByParentChat,
  db,
  deleteParentChat,
  ensureSeedParentChat,
  findOrCreateEmptyParentChat,
  previewText,
  restoreParentChat,
  toggleStarParentChat,
  type ChatMessage,
  type ConversationThread,
  type ParentChat,
} from '@/features/chat/repository'
import { getFirstProviderOfKind } from '@/features/providers/providers-repository'
import {
  DEFAULT_USER_NAME,
  getSettings,
  userInitials,
} from '@/features/settings/settings-repository'
import { cn } from '@/lib/utils'

function matchesSearch(parentChat: ParentChat, query: string) {
  if (!query) {
    return true
  }

  const haystack = `${parentChat.title} ${parentChat.lastActivityPreview}`.toLowerCase()
  return haystack.includes(query)
}

function parseChatPath(pathname: string) {
  const match = pathname.match(/^\/chat\/([^/]+)(?:\/thread\/([^/]+))?/)

  return {
    activeChatId: match?.[1],
    activeThreadId: match?.[2],
  }
}

function branchTitle(rootMessage?: ChatMessage) {
  if (!rootMessage) {
    return 'Untitled branch'
  }

  const text = previewText(rootMessage.content)
  return text.length > 32 ? `${text.slice(0, 29)}...` : text || 'Untitled branch'
}

function ChatActionsMenu({
  archived,
  onDelete,
  parentChat,
}: {
  archived?: boolean
  onDelete: () => void
  parentChat: ParentChat
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
          aria-label={`Actions for ${parentChat.title}`}
          className={cn(
            'rounded p-0.5 text-sidebar-fg-muted transition hover:bg-white/15 hover:text-white',
            open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            triggerProps.onClick()
          }}
          ref={triggerProps.ref as RefCallback<HTMLButtonElement>}
          type="button"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {!archived ? (
            <MenuItem
              onSelect={() => {
                void toggleStarParentChat(parentChat.id)
                close()
              }}
            >
              {parentChat.starredAt ? (
                <>
                  <StarOff className="size-3.5 text-ink-muted" />
                  Unstar chat
                </>
              ) : (
                <>
                  <Star className="size-3.5 text-ink-muted" />
                  Star chat
                </>
              )}
            </MenuItem>
          ) : null}
          {archived ? (
            <MenuItem
              onSelect={() => {
                void restoreParentChat(parentChat.id)
                close()
              }}
            >
              <ArchiveRestore className="size-3.5 text-ink-muted" />
              Restore chat
            </MenuItem>
          ) : (
            <MenuItem
              onSelect={() => {
                void archiveParentChat(parentChat.id)
                close()
              }}
            >
              <Archive className="size-3.5 text-ink-muted" />
              Archive chat
            </MenuItem>
          )}
          <MenuItem
            destructive
            onSelect={() => {
              onDelete()
              close()
            }}
          >
            <Trash2 className="size-3.5" />
            Delete chat
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

function isThreadVisible(
  thread: ConversationThread,
  messagesById: Map<string, ChatMessage>,
  activeThreadId?: string,
) {
  if (thread.id === activeThreadId) {
    return true
  }
  const rootMessage = messagesById.get(thread.rootMessageId)
  return Boolean(rootMessage && rootMessage.directReplyCount > 0)
}

function BranchTreeNode({
  activeThreadId,
  depth,
  messagesById,
  parentChatId,
  thread,
  threadsByParent,
}: {
  activeThreadId?: string
  depth: number
  messagesById: Map<string, ChatMessage>
  parentChatId: string
  thread: ConversationThread
  threadsByParent: Map<string, ConversationThread[]>
}) {
  const children = (threadsByParent.get(thread.id) ?? []).filter((child) =>
    isThreadVisible(child, messagesById, activeThreadId),
  )
  const active = thread.id === activeThreadId
  const rootMessage = messagesById.get(thread.rootMessageId)
  const title = branchTitle(rootMessage)

  return (
    <>
      <Link
        className={cn(
          'group relative mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-small transition',
          active
            ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
            : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
        )}
        params={{ chatId: parentChatId, threadId: thread.id }}
        style={{ paddingLeft: `${10 + depth * 18}px` }}
        to="/chat/$chatId/thread/$threadId"
      >
        {depth > 0 ? (
          <>
            <span
              className="absolute bottom-1/2 top-0 w-px bg-sidebar-line"
              style={{ left: `${8 + (depth - 1) * 18}px` }}
            />
            <span
              className="absolute top-1/2 h-px w-3 bg-sidebar-line"
              style={{ left: `${8 + (depth - 1) * 18}px` }}
            />
          </>
        ) : null}
        <GitBranch className={cn('size-3.5 shrink-0', active ? 'text-sidebar-active-fg' : 'text-sidebar-chip')} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className={cn('font-mono text-meta', active ? 'text-sidebar-active-fg/80' : 'text-sidebar-fg-dim')}>
          {rootMessage?.directReplyCount || 'new'}
        </span>
      </Link>
      {children.map((child) => (
        <BranchTreeNode
          activeThreadId={activeThreadId}
          depth={depth + 1}
          key={child.id}
          messagesById={messagesById}
          parentChatId={parentChatId}
          thread={child}
          threadsByParent={threadsByParent}
        />
      ))}
    </>
  )
}

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const { activeChatId, activeThreadId } = parseChatPath(location.pathname)

  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const openRouterProvider = useLiveQuery(
    () => getFirstProviderOfKind('openrouter'),
    [],
    undefined,
  )
  const savedMessageCount = useLiveQuery(() => db.savedMessages.count(), [], 0)
  const parentChats = useLiveQuery(
    () => db.parentChats.orderBy('updatedAt').reverse().toArray(),
    [],
    [],
  )
  const threadCountByParentChat = useLiveQuery(
    () => countStartedBranchesByParentChat(),
    [],
    new Map<string, number>(),
  )
  const activeThreads = useLiveQuery(
    () =>
      activeChatId
        ? db.threads.where('parentChatId').equals(activeChatId).sortBy('createdAt')
        : Promise.resolve([] as ConversationThread[]),
    [activeChatId],
    [] as ConversationThread[],
  )
  const branchRootMessages = useLiveQuery(
    async () => {
      if (activeThreads.length === 0) {
        return []
      }

      return db.messages.bulkGet(activeThreads.map((thread) => thread.rootMessageId))
    },
    [activeThreads],
    [] as Array<ChatMessage | undefined>,
  )

  useEffect(() => {
    void ensureSeedParentChat()
  }, [])

  useEffect(() => {
    const theme = settings?.theme ?? 'aubergine'
    document.documentElement.dataset.theme = theme
  }, [settings?.theme])

  const handleNewParentChat = async () => {
    const parentChat = await findOrCreateEmptyParentChat()
    await navigate({
      to: '/chat/$chatId',
      params: { chatId: parentChat.id },
    })
  }

  const handleDeleteParentChat = async (parentChat: ParentChat) => {
    const confirmed = window.confirm(
      `Delete "${parentChat.title}"? All messages and branches will be removed.`,
    )
    if (!confirmed) {
      return
    }

    const wasActive = activeChatId === parentChat.id
    await deleteParentChat(parentChat.id)
    if (wasActive) {
      await navigate({ to: '/' })
    }
  }

  const visibleParentChats = parentChats.filter((chat) =>
    matchesSearch(chat, deferredSearch),
  )
  const activeParentChats = visibleParentChats.filter((chat) => !chat.archivedAt)
  const archivedParentChats = visibleParentChats.filter((chat) => Boolean(chat.archivedAt))
  const starredParentChats = activeParentChats
    .filter((chat) => Boolean(chat.starredAt))
    .sort((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0))
  const recentParentChats = activeParentChats.filter((chat) => !chat.starredAt)
  const RECENT_LIMIT = 8
  const visibleRecentParentChats = recentParentChats.slice(0, RECENT_LIMIT)
  const hasMoreRecent = recentParentChats.length > RECENT_LIMIT
  const activeParentChat = activeChatId
    ? parentChats.find((chat) => chat.id === activeChatId)
    : undefined
  const userName = settings?.userName ?? DEFAULT_USER_NAME
  const avatarDataUrl = settings?.avatarDataUrl
  const hasProviderKey = Boolean(openRouterProvider?.apiKey?.trim())
  const messagesById = new Map(
    branchRootMessages
      .filter((message): message is ChatMessage => Boolean(message))
      .map((message) => [message.id, message]),
  )
  const rootThreads = activeThreads.filter(
    (thread) =>
      !thread.parentThreadId && isThreadVisible(thread, messagesById, activeThreadId),
  )
  const threadsByParent = activeThreads.reduce(
    (map, thread) => {
      if (!thread.parentThreadId) {
        return map
      }

      const siblings = map.get(thread.parentThreadId) ?? []
      siblings.push(thread)
      map.set(thread.parentThreadId, siblings)
      return map
    },
    new Map<string, ConversationThread[]>(),
  )

  return (
    <div className="h-screen overflow-hidden bg-canvas text-ink">
      <div className="grid h-full min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-fg lg:flex">
          <div className="border-b border-sidebar-line px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-heading font-bold tracking-tight text-white">
                llm-slack
              </div>
              <Link
                className="rounded-md p-1.5 text-sidebar-fg-muted transition hover:bg-sidebar-hover hover:text-white"
                to="/settings"
              >
                <Settings2 className="size-4" />
              </Link>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-md bg-black/25 px-3 py-2 text-small text-sidebar-fg-muted">
              <Search className="size-4" />
              <Input
                className="h-6 border-0 bg-transparent p-0 font-mono text-small text-white shadow-none placeholder:text-sidebar-fg-dim focus-visible:ring-0"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="search or run /command"
                value={search}
              />
              <span className="rounded border border-sidebar-line px-1.5 py-0.5 font-mono text-meta">
                ⌘K
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            <div className="px-2">
              <Link
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-body font-medium text-white transition hover:bg-sidebar-hover',
                  location.pathname === '/saved' ? 'bg-sidebar-active' : '',
                )}
                to="/saved"
              >
                <Bookmark className="size-4" />
                <span className="flex-1">Saved for later</span>
                <span className="font-mono text-meta text-sidebar-fg-dim">private</span>
                <span className="rounded bg-white/10 px-1.5 font-mono text-meta font-semibold text-sidebar-chip">
                  {savedMessageCount}
                </span>
              </Link>
            </div>

            {starredParentChats.length > 0 ? (
              <section className="mt-5">
                <div className="mb-1 flex items-center gap-1.5 px-4 font-mono text-meta font-bold uppercase leading-none tracking-[0.08em] text-sidebar-fg-muted">
                  <Star aria-hidden="true" className="size-3 shrink-0 text-sidebar-fg-muted" strokeWidth={2.5} />
                  <span>Starred</span>
                </div>
                {starredParentChats.map((parentChat) => {
                  const active =
                    location.pathname === `/chat/${parentChat.id}` ||
                    location.pathname.startsWith(`/chat/${parentChat.id}/thread/`)
                  const branchCount = threadCountByParentChat.get(parentChat.id) ?? 0

                  return (
                    <div
                      className={cn(
                        'group mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-body transition',
                        active
                          ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
                          : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
                      )}
                      key={parentChat.id}
                    >
                      <Link
                        className="flex min-w-0 flex-1 items-center gap-2"
                        params={{ chatId: parentChat.id }}
                        to="/chat/$chatId"
                      >
                        <span className="min-w-0 flex-1 truncate">{parentChat.title}</span>
                        {branchCount > 0 ? (
                          <span className="rounded bg-white/10 px-1.5 font-mono text-meta font-semibold text-sidebar-chip">
                            ↳{branchCount}
                          </span>
                        ) : null}
                      </Link>
                      <ChatActionsMenu
                        onDelete={() => void handleDeleteParentChat(parentChat)}
                        parentChat={parentChat}
                      />
                    </div>
                  )
                })}
              </section>
            ) : null}

            {activeParentChat && rootThreads.length > 0 ? (
              <section className="mt-5">
                <div className="mb-1 flex items-center justify-between px-4">
                  <span className="font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                    This conversation
                  </span>
                  <span className="font-mono text-meta text-sidebar-fg-dim">map ↗</span>
                </div>
                {rootThreads.map((thread) => (
                  <BranchTreeNode
                    activeThreadId={activeThreadId}
                    depth={1}
                    key={thread.id}
                    messagesById={messagesById}
                    parentChatId={activeParentChat.id}
                    thread={thread}
                    threadsByParent={threadsByParent}
                  />
                ))}
              </section>
            ) : null}

            <section className="mt-5">
              <div className="mb-1 px-4 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                Recent
              </div>
              {visibleRecentParentChats.length === 0 ? (
                <div className="px-4 py-1 text-meta text-sidebar-fg-dim">No other chats.</div>
              ) : (
                visibleRecentParentChats.map((parentChat) => {
                  const branchCount = threadCountByParentChat.get(parentChat.id) ?? 0
                  const active = parentChat.id === activeChatId

                  return (
                    <div
                      className={cn(
                        'group mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-body transition',
                        active
                          ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
                          : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
                      )}
                      key={parentChat.id}
                    >
                      <Link
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate"
                        params={{ chatId: parentChat.id }}
                        to="/chat/$chatId"
                      >
                        <Hash className="size-3.5 shrink-0 text-sidebar-fg-dim" />
                        <span className="min-w-0 flex-1 truncate">{parentChat.title}</span>
                        {branchCount > 0 ? (
                          <span className="rounded bg-white/10 px-1.5 font-mono text-meta font-semibold text-sidebar-chip">
                            ↳{branchCount}
                          </span>
                        ) : null}
                      </Link>
                      <ChatActionsMenu
                        onDelete={() => void handleDeleteParentChat(parentChat)}
                        parentChat={parentChat}
                      />
                    </div>
                  )
                })
              )}
              {hasMoreRecent ? (
                <Link
                  className="mt-1 block px-4 py-1 font-mono text-meta font-semibold text-sidebar-chip transition hover:text-white"
                  to="/chats"
                >
                  View all conversations →
                </Link>
              ) : null}
            </section>

            {showArchived ? (
              <section className="mt-5">
                <div className="mb-1 px-4 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                  Archived
                </div>
                {archivedParentChats.length === 0 ? (
                  <div className="px-4 py-2 text-meta text-sidebar-fg-dim">No archived chats.</div>
                ) : (
                  archivedParentChats.map((parentChat) => (
                    <div
                      className="group flex items-center gap-2 px-4 py-1 text-body text-sidebar-fg transition hover:bg-sidebar-hover hover:text-white"
                      key={parentChat.id}
                    >
                      <ArchiveRestore className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{parentChat.title}</span>
                      <ChatActionsMenu
                        archived
                        onDelete={() => void handleDeleteParentChat(parentChat)}
                        parentChat={parentChat}
                      />
                    </div>
                  ))
                )}
              </section>
            ) : null}
          </div>

          <div className="border-t border-sidebar-line p-3">
            <Link
              className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-fg transition hover:bg-sidebar-hover hover:text-white"
              to="/profile"
            >
              {avatarDataUrl ? (
                <img
                  alt={`${userName} avatar`}
                  className="size-7 shrink-0 rounded bg-yellow object-cover"
                  src={avatarDataUrl}
                />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded bg-yellow font-mono text-meta font-black text-sidebar">
                  {userInitials(userName)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-semibold">{userName}</span>
                <span className="block font-mono text-meta text-sidebar-fg-dim">local profile</span>
              </span>
            </Link>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-meta font-medium transition hover:opacity-90',
                  hasProviderKey ? 'bg-send-soft text-send' : 'bg-warn/15 text-warn',
                )}
                to="/settings"
              >
                <KeyRound className="size-3" />
                {hasProviderKey ? 'Provider connected' : 'Connect a provider'}
              </Link>
              <a
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-meta font-medium text-sidebar-fg-muted transition hover:bg-sidebar-hover hover:text-white"
                href="https://github.com/romanlv/llm-slack"
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-3" />
                GitHub
              </a>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button className="h-9 justify-center rounded bg-sidebar-hover text-white hover:bg-white/15" onClick={handleNewParentChat}>
                <MessageSquarePlus className="size-4" />
                New
              </Button>
              <button
                className="rounded border border-sidebar-line px-3 text-meta font-medium text-sidebar-fg transition hover:bg-sidebar-hover hover:text-white"
                onClick={() => setShowArchived((value) => !value)}
                type="button"
              >
                {showArchived ? 'Hide archived' : 'Archived'}
              </button>
            </div>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden bg-surface shadow-[inset_1px_0_0_var(--line)]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
