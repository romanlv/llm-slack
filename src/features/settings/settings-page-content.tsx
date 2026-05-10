import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ExternalLink, ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ModelPicker } from '@/features/model-selection/components/model-picker'
import {
  APP_THEMES,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type AppTheme,
} from '@/features/settings/settings-repository'
import { DEFAULT_OPENROUTER_MODEL } from '@/features/providers/openrouter-models'
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

export function SettingsPageContent() {
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS)
  const [savedMessage, setSavedMessage] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    await saveSettings({
      defaultModel:
        String(formData.get('defaultModel') ?? '').trim() || DEFAULT_OPENROUTER_MODEL,
      openRouterApiKey: String(formData.get('openRouterApiKey') ?? '').trim(),
    siteName: String(formData.get('siteName') ?? '').trim() || 'llm-slack',
      siteUrl: String(formData.get('siteUrl') ?? '').trim(),
    })

    setSavedMessage('Settings saved locally in IndexedDB.')
    window.setTimeout(() => setSavedMessage(''), 2500)
  }

  const handleThemeChange = (theme: AppTheme) => {
    void saveSettings({ theme })
  }

  return (
    <div className="p-6 md:p-10">
      <CardHeader className="px-0 pt-0">
        <Badge>Settings</Badge>
        <CardTitle className="text-3xl">OpenRouter configuration</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          This app runs in the browser only. Your OpenRouter API key stays on this
          device and is sent directly from the browser to OpenRouter.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 px-0 pb-0">
        <section className="grid gap-3">
          <div>
            <h3 className="text-heading font-semibold text-ink">Appearance</h3>
            <p className="mt-1 text-small text-ink-muted">
              Themes recolor the entire workspace. The choice is stored locally.
            </p>
          </div>
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
        </section>

        <form
          className="grid gap-4"
          key={
            settings
              ? `${settings.defaultModel}:${settings.siteName}:${settings.siteUrl}:${settings.openRouterApiKey.length}`
              : 'settings-loading'
          }
          onSubmit={handleSubmit}
        >
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">OpenRouter API key</span>
            <Input
              defaultValue={settings?.openRouterApiKey ?? ''}
              name="openRouterApiKey"
              placeholder="sk-or-v1-..."
              type="password"
            />
          </label>

          <ModelPicker
            defaultValue={settings?.defaultModel ?? DEFAULT_OPENROUTER_MODEL}
            description="Visible options are high-ranked OpenRouter models checked on April 23, 2026. You can still enter any valid model slug."
            label="Default model"
            name="defaultModel"
          />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">App title header</span>
              <Input
                defaultValue={settings?.siteName ?? 'llm-slack'}
                name="siteName"
                placeholder="llm-slack"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Referer URL</span>
              <Input
                defaultValue={settings?.siteUrl ?? ''}
                name="siteUrl"
                placeholder="https://example.com"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit">Save settings</Button>
            {savedMessage ? (
              <p className="text-sm text-muted-foreground">{savedMessage}</p>
            ) : null}
          </div>
        </form>

        <div className="rounded-md border border-warn/30 bg-pin-bg p-5 text-small leading-6 text-ink-muted">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <p className="font-semibold text-ink">Browser-only security tradeoff</p>
              <p className="mt-1">
                Anyone with local access to this browser profile can read the saved
                key. This is acceptable for local testing, but not for a public app
                that uses your own shared production credentials.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface p-5 text-small leading-6 text-ink-muted">
          <p className="font-semibold text-ink">Test flow</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Paste your OpenRouter API key here and save.</li>
            <li>Open or create a conversation.</li>
            <li>
              Pick a trending slug such as `tencent/hy3-preview:free`, or enter
              any other OpenRouter model.
            </li>
            <li>Send a message in the main conversation.</li>
            <li>Open a thread from that message and confirm replies stream in the thread pane.</li>
          </ol>

          <a
            className="mt-4 inline-flex items-center gap-2 text-ink underline"
            href="https://openrouter.ai/docs/api-reference/chat-completion"
            rel="noreferrer"
            target="_blank"
          >
            OpenRouter chat completion docs
            <ExternalLink className="size-4" />
          </a>
        </div>
      </CardContent>
    </div>
  )
}
