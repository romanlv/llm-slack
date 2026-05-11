import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Outlet } from '@tanstack/react-router'

import { ensureSeedParentChat } from '@/features/chat/repository'
import { getSettings } from '@/features/settings/settings-repository'

// AppShell is the root layout for every route. It owns the viewport
// background and the global side-effects that should fire on any page —
// theme application and the one-time seed chat. The actual chat sidebar
// lives in ChatShell, settings in SettingsShell; this layer renders no
// chrome of its own so the two sidebars are mutually exclusive.
export function AppShell() {
  const settings = useLiveQuery(() => getSettings(), [], undefined)

  useEffect(() => {
    void ensureSeedParentChat()
  }, [])

  useEffect(() => {
    const theme = settings?.theme ?? 'aubergine'
    document.documentElement.dataset.theme = theme
  }, [settings?.theme])

  return (
    <div className="h-screen overflow-hidden bg-canvas text-ink">
      <Outlet />
    </div>
  )
}
