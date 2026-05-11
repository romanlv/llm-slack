import { cn } from '@/lib/utils'

// Stable hash → palette index. Same agent id (or display name fallback)
// always renders with the same dot color so the user can recognize an agent
// at a glance across the sidebar, message rows, and pickers.
const PALETTE = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-slate-500',
] as const

function hashToIndex(seed: string, modulo: number) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % modulo
}

function paletteFor(seed: string) {
  return PALETTE[hashToIndex(seed, PALETTE.length)] ?? PALETTE[0]
}

function glyphFor(displayName: string) {
  const trimmed = displayName.trim()
  if (!trimmed) return '?'
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase()
  }
  return (words[0]![0]! + (words[1]![0] ?? '')).toUpperCase()
}

const SIZE_CLASSES = {
  sm: 'size-5 text-[9px]',
  md: 'size-7 text-[11px]',
  lg: 'size-9 text-[13px]',
} as const

export type AgentDotSize = keyof typeof SIZE_CLASSES

export function AgentDot({
  agentId,
  displayName,
  size = 'md',
  className,
}: {
  // Color seed. Falls back to displayName when the agent has no stable id
  // yet (e.g. the editor's live preview before save).
  agentId?: string | null
  displayName: string
  size?: AgentDotSize
  className?: string
}) {
  const seed = agentId?.trim() || displayName
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-mono font-bold text-white',
        SIZE_CLASSES[size],
        paletteFor(seed),
        className,
      )}
    >
      {glyphFor(displayName)}
    </span>
  )
}
