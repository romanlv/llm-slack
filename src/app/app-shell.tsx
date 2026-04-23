import { useDeferredValue, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  KeyRound,
  MessageSquarePlus,
  Search,
  Settings2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  archiveParentChat,
  createParentChat,
  db,
  ensureSeedParentChat,
  getSettings,
  restoreParentChat,
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

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const parentChats = useLiveQuery(
    () => db.parentChats.orderBy('updatedAt').reverse().toArray(),
    [],
    [],
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

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid h-[calc(100vh-2rem)] max-w-[1600px] gap-4 md:h-[calc(100vh-3rem)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="flex flex-col overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Deepchat
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                  Parent chats
                </h1>
              </div>
              <Link
                className="rounded-full border border-border p-2 text-muted-foreground transition hover:bg-white"
                to="/settings"
              >
                <Settings2 className="size-4" />
              </Link>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-input bg-white/70 px-3">
              <Search className="size-4 text-muted-foreground" />
              <Input
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search parent chats"
                value={search}
              />
            </div>

            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
                onClick={() => setShowArchived((value) => !value)}
                type="button"
              >
                {showArchived ? 'Hide archived' : 'Show archived'}
              </button>

              <div
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium',
                  settings?.openRouterApiKey
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-800',
                )}
              >
                <KeyRound className="size-3" />
                {settings?.openRouterApiKey ? 'OpenRouter ready' : 'Add API key'}
              </div>
            </div>

            <Button className="w-full justify-center" onClick={handleNewParentChat}>
              <MessageSquarePlus className="size-4" />
              New parent chat
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-5">
              <section>
                <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Active
                </div>

                <div className="space-y-2">
                  {activeParentChats.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {parentChats.length === 0
                        ? 'Creating your first parent chat...'
                        : 'No parent chats match this search.'}
                    </div>
                  ) : (
                    activeParentChats.map((parentChat) => {
                      const active =
                        location.pathname === `/chat/${parentChat.id}` ||
                        location.pathname.startsWith(`/chat/${parentChat.id}/thread/`)

                      return (
                        <div
                          className={cn(
                            'group rounded-2xl border transition',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-transparent bg-white/55 hover:border-border hover:bg-white',
                          )}
                          key={parentChat.id}
                        >
                          <Link
                            className="block px-4 py-3"
                            params={{ chatId: parentChat.id }}
                            to="/chat/$chatId"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{parentChat.title}</p>
                                <p
                                  className={cn(
                                    'mt-1 line-clamp-2 text-xs',
                                    active
                                      ? 'text-primary-foreground/75'
                                      : 'text-muted-foreground',
                                  )}
                                >
                                  {parentChat.lastActivityPreview}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  'shrink-0 text-[11px]',
                                  active
                                    ? 'text-primary-foreground/75'
                                    : 'text-muted-foreground',
                                )}
                              >
                                {formatUpdatedAt(parentChat.updatedAt)}
                              </span>
                            </div>
                          </Link>

                          <div className="flex justify-end px-3 pb-3">
                            <button
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition',
                                active
                                  ? 'text-primary-foreground/80 hover:bg-white/12'
                                  : 'text-muted-foreground hover:bg-secondary',
                              )}
                              onClick={() => void archiveParentChat(parentChat.id)}
                              type="button"
                            >
                              <Archive className="size-3.5" />
                              Archive
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </section>

              {showArchived ? (
                <section>
                  <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Archived
                  </div>

                  <div className="space-y-2">
                    {archivedParentChats.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                        No archived parent chats yet.
                      </div>
                    ) : (
                      archivedParentChats.map((parentChat) => (
                        <div
                          className="rounded-2xl border border-border bg-white/45 px-4 py-3"
                          key={parentChat.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <Link
                              className="min-w-0 flex-1"
                              params={{ chatId: parentChat.id }}
                              to="/chat/$chatId"
                            >
                              <p className="truncate text-sm font-medium text-foreground">
                                {parentChat.title}
                              </p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {parentChat.lastActivityPreview}
                              </p>
                            </Link>
                            <button
                              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-secondary"
                              onClick={() => void restoreParentChat(parentChat.id)}
                              type="button"
                            >
                              <ArchiveRestore className="size-3.5" />
                              Restore
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="min-h-0 overflow-y-auto">
          <Outlet />
        </Card>
      </div>
    </div>
  )
}
