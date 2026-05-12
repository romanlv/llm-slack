import { Fragment, useDeferredValue, useState } from 'react'
import type { RefCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  ExternalLink,
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
import { AgentDot } from '@/features/agents/agent-dot'
import {
  archiveParentChat,
  countStartedBranchesByParentChat,
  db,
  deleteParentChat,
  restoreParentChat,
  toggleStarParentChat,
  type ParentChat,
} from '@/features/chat/repository'
import { ChatBranchesSlot } from '@/features/chat/components/active-chat-branches'
import { NewChatModal } from '@/features/chat/components/new-chat-modal'
import { listProviders } from '@/features/providers/providers-repository'
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

function DmRowGlyph({ parentChat }: { parentChat: ParentChat }) {
  // Agent-DMs get a small AgentDot (chat.title === agent.displayName at
  // creation; agentId seeds the palette). Model-DMs keep today's "#" mark.
  if (parentChat.kind === 'dm' && parentChat.agentId) {
    return (
      <AgentDot
        agentId={parentChat.agentId}
        displayName={parentChat.title}
        size="sm"
      />
    )
  }
  return <Hash aria-hidden="true" className="size-3.5 shrink-0 text-sidebar-fg-dim" />
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

// ChatShell is the chat-area layout: the conversations sidebar (recent /
// starred / branches / archived) plus the active route's content. It is the
// layout for chat-related routes only — settings routes use SettingsShell
// instead, so the two sidebars are mutually exclusive rather than stacked.
export function ChatShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const { activeChatId, activeThreadId } = parseChatPath(location.pathname)

  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const providers = useLiveQuery(() => listProviders(), [], [])
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

  const handleNewParentChat = () => {
    setNewChatOpen(true)
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
  // DM-equivalent listings (Starred, Recent) filter to kind='dm' so
  // channels stay in their own section. Star remains a per-chat affordance
  // regardless of kind, so starred channels surface under Channels as
  // pinned rows rather than in the DM Starred group.
  const dmParentChats = activeParentChats.filter((chat) => chat.kind === 'dm')
  const channelParentChats = activeParentChats.filter(
    (chat) => chat.kind === 'channel',
  )
  const starredParentChats = dmParentChats
    .filter((chat) => Boolean(chat.starredAt))
    .sort((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0))
  const recentParentChats = dmParentChats.filter((chat) => !chat.starredAt)
  const RECENT_LIMIT = 8
  const visibleRecentParentChats = recentParentChats.slice(0, RECENT_LIMIT)
  const hasMoreRecent = recentParentChats.length > RECENT_LIMIT
  const visibleChannelParentChats = [...channelParentChats].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )
  const userName = settings?.userName ?? DEFAULT_USER_NAME
  const avatarDataUrl = settings?.avatarDataUrl
  const hasProviderKey = providers.some((provider) => provider.apiKey?.trim())

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-fg lg:flex">
        <div className="border-b border-sidebar-line px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 truncate text-heading font-bold tracking-tight text-white">
              llm-slack
            </div>
            <a
              aria-label="GitHub repository"
              className="rounded-md p-1.5 text-sidebar-fg-muted transition hover:bg-sidebar-hover hover:text-white"
              href="https://github.com/romanlv/llm-slack"
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-4" />
            </a>
            <div className="flex-1" />
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

          <Button
            className="mt-3 h-9 w-full justify-center rounded bg-sidebar-hover text-white hover:bg-white/15"
            onClick={handleNewParentChat}
          >
            <MessageSquarePlus className="size-4" />
            New chat
          </Button>
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
                const active = parentChat.id === activeChatId
                const branchCount = threadCountByParentChat.get(parentChat.id) ?? 0

                return (
                  <Fragment key={parentChat.id}>
                    <div
                      className={cn(
                        'group mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-body transition',
                        active
                          ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
                          : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
                      )}
                    >
                      <Link
                        className="flex min-w-0 flex-1 items-center gap-2"
                        params={{ chatId: parentChat.id }}
                        to="/chat/$chatId"
                      >
                        <DmRowGlyph parentChat={parentChat} />
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
                    <ChatBranchesSlot
                      active={active}
                      activeThreadId={activeThreadId}
                      parentChatId={parentChat.id}
                    />
                  </Fragment>
                )
              })}
            </section>
          ) : null}

          {visibleChannelParentChats.length > 0 ? (
            <section className="mt-5">
              <div className="mb-1 flex items-center justify-between px-4 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Hash aria-hidden="true" className="size-3 shrink-0" />
                  Channels
                </span>
                <span className="font-mono text-meta text-sidebar-fg-dim">
                  {visibleChannelParentChats.length}
                </span>
              </div>
              {visibleChannelParentChats.map((parentChat) => {
                const active = parentChat.id === activeChatId
                return (
                  <Fragment key={parentChat.id}>
                    <div
                      className={cn(
                        'group mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-body transition',
                        active
                          ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
                          : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
                      )}
                    >
                      <Link
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate"
                        params={{ chatId: parentChat.id }}
                        to="/chat/$chatId"
                      >
                        <Hash className="size-3.5 shrink-0 text-sidebar-fg-dim" />
                        <span className="min-w-0 flex-1 truncate">{parentChat.title}</span>
                      </Link>
                      <ChatActionsMenu
                        onDelete={() => void handleDeleteParentChat(parentChat)}
                        parentChat={parentChat}
                      />
                    </div>
                    <ChatBranchesSlot
                      active={active}
                      activeThreadId={activeThreadId}
                      parentChatId={parentChat.id}
                    />
                  </Fragment>
                )
              })}
            </section>
          ) : null}

          <section className="mt-5">
            <div className="mb-1 flex items-center justify-between px-4 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
              <span>Recent</span>
              <button
                className="rounded px-1.5 py-0.5 text-sidebar-fg-muted transition hover:bg-sidebar-hover hover:text-white"
                onClick={() => setShowArchived((value) => !value)}
                type="button"
              >
                {showArchived ? 'Hide archived' : 'Archived'}
              </button>
            </div>
            {visibleRecentParentChats.length === 0 ? (
              <div className="px-4 py-1 text-meta text-sidebar-fg-dim">No other chats.</div>
            ) : (
              visibleRecentParentChats.map((parentChat) => {
                const branchCount = threadCountByParentChat.get(parentChat.id) ?? 0
                const active = parentChat.id === activeChatId

                return (
                  <Fragment key={parentChat.id}>
                    <div
                      className={cn(
                        'group mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-body transition',
                        active
                          ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
                          : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
                      )}
                    >
                      <Link
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate"
                        params={{ chatId: parentChat.id }}
                        to="/chat/$chatId"
                      >
                        <DmRowGlyph parentChat={parentChat} />
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
                    <ChatBranchesSlot
                      active={active}
                      activeThreadId={activeThreadId}
                      parentChatId={parentChat.id}
                    />
                  </Fragment>
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
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-fg transition hover:bg-sidebar-hover hover:text-white',
              hasProviderKey ? '' : 'mb-3',
            )}
            to="/settings/profile"
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
          {hasProviderKey ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="inline-flex items-center gap-1 rounded bg-warn/15 px-2 py-1 text-meta font-medium text-warn transition hover:opacity-90"
                to="/settings"
              >
                <KeyRound className="size-3" />
                Connect a provider
              </Link>
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden bg-surface shadow-[inset_1px_0_0_var(--line)]">
        <Outlet />
      </main>

      <NewChatModal onOpenChange={setNewChatOpen} open={newChatOpen} />
    </div>
  )
}
