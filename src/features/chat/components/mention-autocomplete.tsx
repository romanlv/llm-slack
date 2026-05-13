import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'

import type { Agent } from '@/features/chat/domain'
import { cn } from '@/lib/utils'

import { AgentDot } from '@/features/agents/agent-dot'

import {
  filterAgentsForMention,
  type MentionQuery,
} from './mention-autocomplete-engine'

export interface MentionAutocompleteHandle {
  next(): boolean
  prev(): boolean
  accept(): boolean
}

interface MentionAutocompleteProps {
  agents: Agent[]
  query: MentionQuery | null
  onSelect(agent: Agent): void
  ref?: RefObject<MentionAutocompleteHandle | null>
}

export function MentionAutocomplete({ agents, query, onSelect, ref }: MentionAutocompleteProps) {
  const filtered = useMemo(
    () => filterAgentsForMention({ agents, query: query?.query ?? '' }),
    [agents, query?.query],
  )
  const queryKey = query?.query ?? ''
  // Selection is keyed by the active filter query so changing the query
  // resets the highlight to the top without needing a synchronous setState
  // in an effect.
  const [selectionByQuery, setSelectionByQuery] = useState<{
    queryKey: string
    index: number
  }>({ queryKey, index: 0 })
  const activeIndex =
    selectionByQuery.queryKey === queryKey
      ? Math.min(selectionByQuery.index, Math.max(0, filtered.length - 1))
      : 0

  // Capture the latest values for the imperative handle so the parent's
  // onKeyDown closure always sees the current filter/highlight without
  // re-creating the handle each render.
  const stateRef = useRef({ filtered, activeIndex, queryKey })
  useEffect(() => {
    stateRef.current = { filtered, activeIndex, queryKey }
  })

  useImperativeHandle(
    ref,
    () => ({
      next() {
        const { filtered, activeIndex, queryKey } = stateRef.current
        if (filtered.length === 0) return false
        setSelectionByQuery({
          queryKey,
          index: (activeIndex + 1) % filtered.length,
        })
        return true
      },
      prev() {
        const { filtered, activeIndex, queryKey } = stateRef.current
        if (filtered.length === 0) return false
        setSelectionByQuery({
          queryKey,
          index: (activeIndex - 1 + filtered.length) % filtered.length,
        })
        return true
      },
      accept() {
        const { filtered, activeIndex } = stateRef.current
        const target = filtered[activeIndex]
        if (!target) return false
        onSelect(target)
        return true
      },
    }),
    [onSelect],
  )

  if (!query || filtered.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-5 right-5 z-20 mb-2 max-h-72 overflow-y-auto rounded-md border border-line-strong bg-surface shadow-lg"
      data-testid="mention-autocomplete"
      role="listbox"
    >
      {filtered.map((agent, i) => (
        <button
          aria-selected={i === activeIndex}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-body transition',
            i === activeIndex ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-surface-muted',
          )}
          onMouseEnter={() => setSelectionByQuery({ queryKey, index: i })}
          // Use mousedown rather than click so the click fires before the
          // textarea's blur handler closes the popup.
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(agent)
          }}
          key={agent.id}
          role="option"
          type="button"
        >
          <AgentDot agentId={agent.id} displayName={agent.displayName} size="sm" />
          <span className="font-semibold">{agent.displayName}</span>
          <span className="font-mono text-meta text-ink-muted">@{agent.username}</span>
        </button>
      ))}
    </div>
  )
}
