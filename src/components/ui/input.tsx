import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Input({
  className,
  type = 'text',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-11 w-full rounded-2xl border border-input bg-surface px-4 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-4 focus-visible:ring-ring',
        className,
      )}
      type={type}
      {...props}
    />
  )
}
