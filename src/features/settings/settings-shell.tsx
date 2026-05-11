import type { ReactNode } from 'react'
import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  to?: string
  disabled?: boolean
  matchPrefix?: string
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Account',
    items: [
      { label: 'Profile', to: '/settings/profile' },
      { label: 'Preferences', to: '/settings/preferences' },
    ],
  },
  {
    label: 'AI',
    items: [
      {
        label: 'Model providers',
        to: '/settings/providers',
        matchPrefix: '/settings/providers',
      },
    ],
  },
]

export function SettingsShell({ children }: { children?: ReactNode } = {}) {
  const location = useLocation()
  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-3 border-r border-sidebar-line bg-sidebar px-2 py-4 text-sidebar-fg md:flex">
        <Link
          className="mx-2 inline-flex w-fit items-center gap-1.5 rounded-md border border-sidebar-line bg-sidebar-hover/40 px-2 py-1 font-mono text-meta text-sidebar-fg-muted transition hover:text-white"
          to="/"
        >
          <ChevronLeft className="size-3.5" /> Back to chat
          <span className="ml-1 rounded bg-white/10 px-1 text-meta">esc</span>
        </Link>

        <div className="px-3 pb-2 pt-1">
          <div className="text-body font-bold text-white">Settings</div>
          <div className="font-mono text-meta text-sidebar-fg-dim">local profile</div>
        </div>

        {NAV_GROUPS.map((group) => (
          <div className="grid gap-0.5" key={group.label}>
            <div className="px-3 pb-1 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-dim">
              {group.label}
            </div>
            {group.items.map((item) => {
              if (item.disabled || !item.to) {
                return (
                  <span
                    aria-disabled
                    className="mx-1 cursor-not-allowed rounded-md px-3 py-1.5 text-small text-sidebar-fg-dim"
                    key={item.label}
                  >
                    {item.label}
                  </span>
                )
              }
              const active = item.matchPrefix
                ? location.pathname.startsWith(item.matchPrefix)
                : location.pathname === item.to
              return (
                <Link
                  className={cn(
                    'mx-1 rounded-md px-3 py-1.5 text-small transition',
                    active
                      ? 'bg-sidebar-active font-semibold text-sidebar-active-fg'
                      : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
                  )}
                  key={item.label}
                  to={item.to}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </aside>

      <div className="min-h-0 overflow-y-auto bg-surface">{children ?? <Outlet />}</div>
    </div>
  )
}
