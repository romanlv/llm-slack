import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ExternalLink, ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ModelPicker } from '@/features/model-selection/components/model-picker'
import { getSettings, saveSettings } from '@/lib/db'
import { DEFAULT_OPENROUTER_MODEL } from '@/lib/openrouter-models'

export function SettingsPage() {
  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const [savedMessage, setSavedMessage] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    await saveSettings({
      defaultModel:
        String(formData.get('defaultModel') ?? '').trim() || DEFAULT_OPENROUTER_MODEL,
      openRouterApiKey: String(formData.get('openRouterApiKey') ?? '').trim(),
      siteName: String(formData.get('siteName') ?? '').trim() || 'Deepchat',
      siteUrl: String(formData.get('siteUrl') ?? '').trim(),
    })

    setSavedMessage('Settings saved locally in IndexedDB.')
    window.setTimeout(() => setSavedMessage(''), 2500)
  }

  return (
    <div className="p-6 md:p-10">
      <CardHeader className="px-0 pt-0">
        <Badge>Provider settings</Badge>
        <CardTitle className="text-3xl">OpenRouter configuration</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          This app runs in the browser only. Your OpenRouter API key stays on this
          device and is sent directly from the browser to OpenRouter.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 px-0 pb-0">
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
                defaultValue={settings?.siteName ?? 'Deepchat'}
                name="siteName"
                placeholder="Deepchat"
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

        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Browser-only security tradeoff</p>
              <p className="mt-1 text-amber-800">
                Anyone with local access to this browser profile can read the saved
                key. This is acceptable for local testing, but not for a public app
                that uses your own shared production credentials.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-white/70 p-5 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Test flow</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Paste your OpenRouter API key here and save.</li>
            <li>Open or create a parent chat.</li>
            <li>
              Pick a trending slug such as `moonshotai/kimi-k2.6`, or enter
              any other OpenRouter model.
            </li>
            <li>Send a parent-chat message.</li>
            <li>Open a thread from that message and confirm replies stream in the thread pane.</li>
          </ol>

          <a
            className="mt-4 inline-flex items-center gap-2 text-foreground underline"
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
