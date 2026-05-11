import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

type DialogProps = {
  children: ReactNode
  className?: string
  contentLabel?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  // When false, Escape, backdrop clicks, and the close button are
  // suppressed. Callers can flip this off while a destructive or non-
  // cancellable async action is in-flight.
  dismissible?: boolean
}

export function Dialog({
  children,
  className,
  contentLabel,
  onOpenChange,
  open,
  dismissible = true,
}: DialogProps) {
  useEffect(() => {
    if (!open) return

    const handleKey = (event: KeyboardEvent) => {
      if (!dismissible) return
      if (event.key === 'Escape') onOpenChange(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, onOpenChange, dismissible])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onPointerDown={(event) => {
        if (!dismissible) return
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        aria-label={contentLabel}
        aria-modal
        className={cn(
          'relative max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg border border-line bg-surface shadow-2xl',
          className,
        )}
        role="dialog"
      >
        {dismissible ? (
          <button
            aria-label="Close"
            className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-canvas hover:text-ink"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X className="size-4" />
          </button>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  )
}
