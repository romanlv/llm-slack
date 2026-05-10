import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefCallback } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

type TriggerProps = {
  'aria-expanded': boolean
  'aria-haspopup': 'menu'
  onClick: () => void
  open: boolean
  ref: RefCallback<HTMLElement>
}

type MenuPosition = {
  top: number
  left?: number
  right?: number
}

type MenuProps = {
  align?: 'left' | 'right'
  children: (props: { close: () => void }) => ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  trigger: (props: TriggerProps) => ReactNode
}

export function Menu({ align = 'right', children, onOpenChange, open, trigger }: MenuProps) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return
    }

    const rect = triggerRef.current.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 4,
      left: align === 'right' ? undefined : rect.left,
      right: align === 'right' ? Math.max(window.innerWidth - rect.right, 0) : undefined,
    })
  }, [open, align])

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointer(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) {
        return
      }
      onOpenChange(false)
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    window.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, onOpenChange])

  const setTriggerRef = useCallback<RefCallback<HTMLElement>>((element) => {
    triggerRef.current = element
  }, [])

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs -- setTriggerRef is a stable ref callback, not a render-time read of triggerRef.current */}
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        onClick: () => onOpenChange(!open),
        open,
        ref: setTriggerRef,
      })}
      {open && position
        ? createPortal(
            <div
              className="fixed z-40 min-w-[160px] overflow-hidden rounded border border-line-strong bg-surface py-1 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
              ref={menuRef}
              role="menu"
              style={{ top: position.top, left: position.left, right: position.right }}
            >
              {children({ close: () => onOpenChange(false) })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

type MenuItemProps = {
  children: ReactNode
  destructive?: boolean
  onSelect: () => void
}

export function MenuItem({ children, destructive, onSelect }: MenuItemProps) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1 text-left text-small transition hover:bg-surface-muted',
        destructive ? 'text-danger hover:bg-danger/10' : 'text-ink',
      )}
      onClick={onSelect}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
  )
}
