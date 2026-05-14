import { useState } from 'react'
import { Hash } from 'lucide-react'

import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { ChannelParticipantsPanel } from './channel-participants-panel'
import { ChannelSettingsPanel } from './channel-settings-panel'

type Tab = 'agents' | 'general' | 'advanced'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Advanced' },
]

export function ChannelSettingsDialog({
  chatId,
  initialTab,
  onOpenChange,
  open,
  title,
}: {
  chatId: string
  initialTab?: Tab
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
}) {
  return (
    <Dialog
      className="max-w-3xl"
      contentLabel={`Channel settings — ${title}`}
      onOpenChange={onOpenChange}
      open={open}
    >
      {open ? (
        <ChannelSettingsDialogBody
          chatId={chatId}
          initialTab={initialTab ?? 'agents'}
          title={title}
        />
      ) : null}
    </Dialog>
  )
}

function ChannelSettingsDialogBody({
  chatId,
  initialTab,
  title,
}: {
  chatId: string
  initialTab: Tab
  title: string
}) {
  const [tab, setTab] = useState<Tab>(initialTab)

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line bg-surface px-6 py-5 pr-12">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Hash className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="text-small text-ink-muted">
            Manage participants and tune how this channel runs turns.
          </p>
        </div>
      </header>

      <div className="grid max-h-[78vh] grid-cols-[180px_minmax(0,1fr)] overflow-hidden">
        <ul className="overflow-y-auto border-r border-line bg-surface px-2 py-3">
          {TABS.map((entry) => {
            const active = entry.id === tab
            return (
              <li key={entry.id}>
                <button
                  aria-selected={active}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-small transition',
                    active
                      ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                      : 'text-ink hover:bg-canvas/60',
                  )}
                  onClick={() => setTab(entry.id)}
                  role="tab"
                  type="button"
                >
                  <span className="font-semibold">{entry.label}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="overflow-y-auto px-6 py-5" role="tabpanel">
          {tab === 'agents' ? <ChannelParticipantsPanel chatId={chatId} /> : null}
          {tab === 'general' ? (
            <ChannelSettingsPanel chatId={chatId} section="general" />
          ) : null}
          {tab === 'advanced' ? (
            <ChannelSettingsPanel chatId={chatId} section="advanced" />
          ) : null}
        </div>
      </div>
    </>
  )
}
