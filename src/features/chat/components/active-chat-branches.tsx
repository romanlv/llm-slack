import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from '@tanstack/react-router'
import { GitBranch } from 'lucide-react'

import {
  db,
  previewText,
  type ChatMessage,
  type ConversationThread,
} from '@/features/chat/repository'
import { cn } from '@/lib/utils'

function branchTitle(rootMessage?: ChatMessage) {
  if (!rootMessage) {
    return 'Untitled branch'
  }

  const text = previewText(rootMessage.content)
  return text.length > 32 ? `${text.slice(0, 29)}...` : text || 'Untitled branch'
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
          'group relative mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-small transition',
          active
            ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
            : 'text-sidebar-fg-muted hover:bg-sidebar-hover hover:text-white',
        )}
        params={{ chatId: parentChatId, threadId: thread.id }}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        to="/chat/$chatId/thread/$threadId"
      >
        <span
          className="absolute bottom-1/2 top-0 w-px bg-sidebar-line"
          style={{ left: `${8 + (depth - 1) * 14}px` }}
        />
        <span
          className="absolute top-1/2 h-px w-2.5 bg-sidebar-line"
          style={{ left: `${8 + (depth - 1) * 14}px` }}
        />
        <GitBranch
          className={cn(
            'size-3 shrink-0',
            active ? 'text-sidebar-active-fg' : 'text-sidebar-chip',
          )}
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span
          className={cn(
            'font-mono text-meta',
            active ? 'text-sidebar-active-fg/80' : 'text-sidebar-fg-dim',
          )}
        >
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

// Slightly longer than the grid-rows transition so the rAF flip inside
// ActiveChatBranches still leaves a full transition window to play out
// before the slot unmounts.
const COLLAPSE_MS = 175

// Keeps a child mounted for `delayMs` after `visible` flips false so the
// child has time to play an exit transition before being removed.
function useDelayedUnmount(visible: boolean, delayMs: number) {
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local mount state with a prop-driven external lifecycle; no derived alternative for the timer-delayed false path
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), delayMs)
    return () => window.clearTimeout(timer)
  }, [visible, delayMs])
  return mounted
}

// ChatBranchesSlot is the call-site wrapper for every chat row. Two
// jobs: (1) keep the inner outline mounted for COLLAPSE_MS after a row
// deactivates so its grid-rows exit transition has time to play, and
// (2) avoid running the inner component's Dexie subscriptions on
// inactive rows — `useDelayedUnmount` starts false for them and stays
// false, so ActiveChatBranches never mounts.
export function ChatBranchesSlot({
  active,
  activeThreadId,
  parentChatId,
}: {
  active: boolean
  activeThreadId?: string
  parentChatId: string
}) {
  const mounted = useDelayedUnmount(active, COLLAPSE_MS)
  if (!mounted) {
    return null
  }
  return (
    <ActiveChatBranches
      active={active}
      activeThreadId={activeThreadId}
      parentChatId={parentChatId}
    />
  )
}

// ActiveChatBranches is the per-chat branch outline that lives directly
// under the active chat row in the sidebar. The outline auto-expands when
// the row activates and collapses when it deactivates; both directions
// animate via a grid-rows transition so the sidebar slides rather than
// jumps. `open` is driven from inside a rAF so the first commit always
// paints with grid-rows-[0fr] before the transition target is applied —
// without that gap the browser has nothing to interpolate from.
function ActiveChatBranches({
  active,
  activeThreadId,
  parentChatId,
}: {
  active: boolean
  activeThreadId?: string
  parentChatId: string
}) {
  const [open, setOpen] = useState(false)

  const chatThreads = useLiveQuery(
    () =>
      db.threads.where('parentChatId').equals(parentChatId).sortBy('createdAt'),
    [parentChatId],
    [] as ConversationThread[],
  )
  const rootMessageIds = useMemo(
    () => chatThreads.map((thread) => thread.rootMessageId),
    [chatThreads],
  )
  // Joined-string key debounces the second query against array-identity
  // churn from useLiveQuery — only the actual id set changing should
  // re-fetch root messages.
  const rootMessageIdsKey = rootMessageIds.join('|')
  const branchRootMessages = useLiveQuery(
    async () => {
      if (rootMessageIds.length === 0) {
        return [] as Array<ChatMessage | undefined>
      }
      return db.messages.bulkGet(rootMessageIds)
    },
    [rootMessageIdsKey],
    [] as Array<ChatMessage | undefined>,
  )

  const { messagesById, rootThreads, threadsByParent } = useMemo(() => {
    const byId = new Map<string, ChatMessage>(
      branchRootMessages
        .filter((message): message is ChatMessage => Boolean(message))
        .map((message) => [message.id, message]),
    )
    const roots = chatThreads.filter(
      (thread) => !thread.parentThreadId && isThreadVisible(thread, byId, activeThreadId),
    )
    const byParent = chatThreads.reduce(
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
    return { messagesById: byId, rootThreads: roots, threadsByParent: byParent }
  }, [chatThreads, branchRootMessages, activeThreadId])

  const hasContent = rootThreads.length > 0

  useEffect(() => {
    // One rAF drives both directions: enter flips false → true after the
    // first paint at 0fr, exit flips true → false to trigger the 1fr → 0fr
    // transition before the slot unmounts. Going through rAF on exit
    // costs one frame of perceived delay (COLLAPSE_MS is sized for it)
    // but keeps the setState out of the effect body for lint, and
    // collapses both paths into one branch-free statement.
    const id = window.requestAnimationFrame(() => {
      setOpen(active && hasContent)
    })
    return () => window.cancelAnimationFrame(id)
  }, [active, hasContent])

  if (!hasContent) {
    return null
  }

  // Single grid-rows transition tied to `open` (a one-frame-lagged mirror of
  // `active`). `inert` hides the collapsed subtree from keyboard tab and
  // screen readers; the grid-rows trick only hides content visually.
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-150 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
      inert={!open}
    >
      <div className="overflow-hidden">
        <div className="mx-2 mt-0.5 pt-0.5">
          {rootThreads.map((thread) => (
            <BranchTreeNode
              activeThreadId={activeThreadId}
              depth={1}
              key={thread.id}
              messagesById={messagesById}
              parentChatId={parentChatId}
              thread={thread}
              threadsByParent={threadsByParent}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
