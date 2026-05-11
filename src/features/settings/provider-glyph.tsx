import { cn } from '@/lib/utils'

import type { ProviderDefinition } from './provider-definitions'

type ProviderGlyphProps = {
  definition: ProviderDefinition
  size?: 9 | 10
}

export function ProviderGlyph({ definition, size = 9 }: ProviderGlyphProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded font-mono text-xs font-extrabold tracking-wide',
        size === 9 ? 'size-9' : 'size-10',
        definition.glyphBg,
        definition.glyphFg,
      )}
    >
      {definition.glyph}
    </div>
  )
}

export function AuthBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded bg-canvas px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
      {label}
    </span>
  )
}
