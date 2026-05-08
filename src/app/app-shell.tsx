import { useDeferredValue, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  GitBranch,
  Hash,
  KeyRound,
  MessageSquarePlus,
  Search,
  Settings2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  archiveParentChat,
  createParentChat,
  db,
  ensureSeedParentChat,
  previewText,
  restoreParentChat,
  type ChatMessage,
  type ConversationThread,
  type ParentChat,
} from '@/lib/db'
import { cn } from '@/lib/utils'

function formatUpdatedAt(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(timestamp)
}

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
  const children = threadsByParent.get(thread.id) ?? []
  const active = thread.id === activeThreadId
  const rootMessage = messagesById.get(thread.rootMessageId)
  const title = branchTitle(rootMessage)

  return (
    <>
      <Link
        className={cn(
          'group relative flex items-center gap-2 px-3 py-1.5 text-sm transition',
          active
            ? 'bg-[#1164a3] font-semibold text-white'
            : 'text-[#d1c7d3] hover:bg-white/8 hover:text-white',
        )}
        params={{ chatId: parentChatId, threadId: thread.id }}
        style={{ paddingLeft: `${18 + depth * 18}px` }}
        to="/chat/$chatId/thread/$threadId"
      >
        {depth > 0 ? (
          <>
            <span
              className="absolute bottom-1/2 top-0 w-px bg-white/12"
              style={{ left: `${16 + (depth - 1) * 18}px` }}
            />
            <span
              className="absolute top-1/2 h-px w-3 bg-white/12"
              style={{ left: `${16 + (depth - 1) * 18}px` }}
            />
          </>
        ) : null}
        <GitBranch className={cn('size-3.5 shrink-0', active ? 'text-white' : 'text-[#d8a7da]')} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className={cn('font-mono text-[10px]', active ? 'text-white/80' : 'text-white/45')}>
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

  const settings = useLiveQuery(() => db.settings.get('app'), [], undefined)
  const parentChats = useLiveQuery(
    () => db.parentChats.orderBy('updatedAt').reverse().toArray(),
    [],
    [],
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

  const handleNewParentChat = async () => {
    const parentChat = await createParentChat()
    await navigate({
      to: '/chat/$chatId',
      params: { chatId: parentChat.id },
    })
  }

  const visibleParentChats = parentChats.filter((chat) =>
    matchesSearch(chat, deferredSearch),
  )
  const activeParentChats = visibleParentChats.filter((chat) => !chat.archivedAt)
  const archivedParentChats = visibleParentChats.filter((chat) => Boolean(chat.archivedAt))
  const activeParentChat = activeChatId
    ? parentChats.find((chat) => chat.id === activeChatId)
    : undefined
  const messagesById = new Map(
    branchRootMessages
      .filter((message): message is ChatMessage => Boolean(message))
      .map((message) => [message.id, message]),
  )
  const rootThreads = activeThreads.filter((thread) => !thread.parentThreadId)
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
    <div className="h-screen overflow-hidden bg-[#f8f8f8] text-[#1d1c1d]">
      <div className="grid h-full min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col overflow-hidden bg-[#3f0e40] text-[#d1c7d3] lg:flex">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#ecb22e] to-[#e01e5a] font-mono text-sm font-black text-[#3f0e40]">
                A
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold text-white">Arcadia Labs</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/55">
                  <span className="size-2 rounded-full bg-[#2bac76]" />
                  Mira Chen
                </div>
              </div>
              <Link
                className="rounded-md p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white"
                to="/settings"
              >
                <Settings2 className="size-4" />
              </Link>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-md bg-black/25 px-3 py-2 text-sm text-white/55">
              <Search className="size-4" />
              <Input
                className="h-6 border-0 bg-transparent p-0 font-mono text-sm text-white shadow-none placeholder:text-white/45 focus-visible:ring-0"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="search or run /command"
                value={search}
              />
              <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px]">
                ⌘K
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            <div className="px-2">
              <button className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-white/8">
                <Bookmark className="size-4" />
                <span className="flex-1">Saved for later</span>
                <span className="font-mono text-xs text-white/45">private</span>
                <span className="rounded bg-white/10 px-1.5 font-mono text-xs text-[#d8a7da]">3</span>
              </button>
            </div>

            <section className="mt-5">
              <div className="mb-1 px-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                Pinned
              </div>
              {activeParentChats.slice(0, 4).map((parentChat) => {
                const active =
                  location.pathname === `/chat/${parentChat.id}` ||
                  location.pathname.startsWith(`/chat/${parentChat.id}/thread/`)

                return (
                  <Link
                    className={cn(
                      'flex items-center gap-2 px-4 py-1.5 text-sm transition',
                      active
                        ? 'bg-[#1164a3] font-semibold text-white'
                        : 'text-[#d1c7d3] hover:bg-white/8 hover:text-white',
                    )}
                    key={parentChat.id}
                    params={{ chatId: parentChat.id }}
                    to="/chat/$chatId"
                  >
                    <Hash className="size-3.5 shrink-0 text-white/45" />
                    <span className="min-w-0 flex-1 truncate">{parentChat.title}</span>
                    <span className="font-mono text-[10px] text-[#d8a7da]">
                      {formatUpdatedAt(parentChat.updatedAt)}
                    </span>
                  </Link>
                )
              })}
            </section>

            {activeParentChat ? (
              <section className="mt-5">
                <div className="mb-1 flex items-center justify-between px-4">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                    Branches
                  </span>
                  <span className="font-mono text-[10px] text-white/45">map ↗</span>
                </div>
                <Link
                  className={cn(
                    'flex items-center gap-2 px-4 py-1.5 text-sm transition',
                    activeChatId && !activeThreadId
                      ? 'bg-[#1164a3] font-semibold text-white'
                      : 'text-[#d1c7d3] hover:bg-white/8 hover:text-white',
                  )}
                  params={{ chatId: activeParentChat.id }}
                  to="/chat/$chatId"
                >
                  <span className="size-2 rounded-full bg-[#2bac76]" />
                  <span className="min-w-0 flex-1 truncate">{activeParentChat.title}</span>
                  <span className="font-mono text-[10px] text-white/45">
                    {rootThreads.length} br
                  </span>
                </Link>
                {rootThreads.length === 0 ? (
                  <div className="px-4 py-2 text-xs leading-5 text-white/45">
                    Hover a message and branch to populate this tree.
                  </div>
                ) : (
                  rootThreads.map((thread) => (
                    <BranchTreeNode
                      activeThreadId={activeThreadId}
                      depth={1}
                      key={thread.id}
                      messagesById={messagesById}
                      parentChatId={activeParentChat.id}
                      thread={thread}
                      threadsByParent={threadsByParent}
                    />
                  ))
                )}
              </section>
            ) : null}

            <section className="mt-5">
              <div className="mb-1 px-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                Recent
              </div>
              {activeParentChats.slice(4).map((parentChat) => (
                <div className="group flex items-center gap-2 px-4 py-1.5 text-sm text-[#d1c7d3]" key={parentChat.id}>
                  <Link
                    className="min-w-0 flex-1 truncate transition hover:text-white"
                    params={{ chatId: parentChat.id }}
                    to="/chat/$chatId"
                  >
                    # {parentChat.title}
                  </Link>
                  <button
                    className="opacity-0 transition hover:text-white group-hover:opacity-100"
                    onClick={() => void archiveParentChat(parentChat.id)}
                    type="button"
                  >
                    <Archive className="size-3.5" />
                  </button>
                </div>
              ))}
            </section>

            {showArchived ? (
              <section className="mt-5">
                <div className="mb-1 px-4 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                  Archived
                </div>
                {archivedParentChats.length === 0 ? (
                  <div className="px-4 py-2 text-xs text-white/45">No archived chats.</div>
                ) : (
                  archivedParentChats.map((parentChat) => (
                    <button
                      className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm text-white/65 transition hover:bg-white/8 hover:text-white"
                      key={parentChat.id}
                      onClick={() => void restoreParentChat(parentChat.id)}
                      type="button"
                    >
                      <ArchiveRestore className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{parentChat.title}</span>
                    </button>
                  ))
                )}
              </section>
            ) : null}
          </div>

          <div className="border-t border-white/10 p-3">
            <div
              className={cn(
                'mb-3 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium',
                settings?.openRouterApiKey
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : 'bg-amber-400/15 text-amber-200',
              )}
            >
              <KeyRound className="size-3" />
              {settings?.openRouterApiKey ? 'OpenRouter ready' : 'Add API key'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button className="h-9 justify-center rounded bg-white/10 text-white hover:bg-white/15" onClick={handleNewParentChat}>
                <MessageSquarePlus className="size-4" />
                New
              </Button>
              <button
                className="rounded border border-white/10 px-3 text-xs font-medium text-white/65 transition hover:bg-white/8 hover:text-white"
                onClick={() => setShowArchived((value) => !value)}
                type="button"
              >
                {showArchived ? 'Hide archived' : 'Archived'}
              </button>
            </div>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden bg-white shadow-[inset_1px_0_0_rgba(10,20,40,0.09)]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
