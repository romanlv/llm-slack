import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

// Replacement for window.confirm — renders in the same Dialog used by the
// rest of the app so keyboard focus, escape-to-cancel, and styling stay
// consistent. Use for destructive actions (disconnect, delete) where the
// browser's native confirm dialog would feel out of place.
type ConfirmDialogProps = {
  body?: ReactNode
  cancelLabel?: string
  confirmLabel: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  title: string
}

export function ConfirmDialog({
  body,
  cancelLabel = 'Cancel',
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <Dialog
      className="max-w-md"
      contentLabel={title}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open={open}
    >
      <div className="grid gap-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {body ? (
            <div className="mt-2 text-small leading-6 text-ink-muted">{body}</div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {cancelLabel}
          </Button>
          <Button
            className={destructive ? 'bg-danger text-white hover:bg-danger/90' : undefined}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
