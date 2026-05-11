import { useLiveQuery } from 'dexie-react-hooks'

import { Badge } from '@/components/ui/badge'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  APP_THEMES,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type AppTheme,
} from '@/features/settings/settings-repository'
import { cn } from '@/lib/utils'

function ThemeSwatch({ theme }: { theme: AppTheme }) {
  return (
    <div className="flex h-12 overflow-hidden rounded border border-line" data-theme={theme}>
      <div className="w-1/3 bg-sidebar" />
      <div className="flex w-2/3 flex-col gap-1 bg-surface px-2 py-1.5">
        <span className="h-1.5 w-2/3 rounded-full bg-ink-dim/40" />
        <span className="inline-flex h-2.5 w-12 items-center rounded-xs bg-send" />
        <span className="h-1 w-1/2 rounded-full bg-accent/60" />
      </div>
    </div>
  )
}

export function PreferencesPageContent() {
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS)
  const handleThemeChange = (theme: AppTheme) => {
    void saveSettings({ theme })
  }

  return (
    <div className="p-6 md:p-10">
      <CardHeader className="px-0 pt-0">
        <Badge>Preferences</Badge>
        <CardTitle className="text-3xl">Appearance</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          Themes recolor the entire workspace. The choice is stored locally on this browser.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 px-0 pb-0">
        <div className="grid gap-2 sm:grid-cols-3">
          {APP_THEMES.map((option) => {
            const selected = (settings?.theme ?? 'aubergine') === option.id
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  'group flex flex-col gap-2 rounded-md border p-3 text-left transition',
                  selected
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface hover:border-accent-border',
                )}
                key={option.id}
                onClick={() => handleThemeChange(option.id)}
                type="button"
              >
                <ThemeSwatch theme={option.id} />
                <div>
                  <div className="text-small font-semibold text-ink">{option.label}</div>
                  <div className="mt-0.5 text-meta text-ink-muted">{option.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </div>
  )
}
