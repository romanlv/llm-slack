import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { db } from '@/features/chat/database'
import type { Agent, ParentChat } from '@/features/chat/domain'

import { AgentDot } from './agent-dot'
import { AgentEditor } from './agent-editor'
import { deleteAgent, listAgents } from './agents-repository'

function modelLabel(agent: Agent) {
  const id = agent.model.providerModelId
  return id.split('/').at(-1) ?? id
}

function AgentRow({
  agent,
  agentChatCount,
  onEdit,
  onDelete,
}: {
  agent: Agent
  agentChatCount: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3">
      <AgentDot agentId={agent.id} displayName={agent.displayName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold text-ink">{agent.displayName}</h3>
          <span className="font-mono text-meta text-accent">@{agent.username}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 font-mono text-meta text-ink-muted">
            {modelLabel(agent)}
          </span>
          {agentChatCount > 0 ? (
            <span className="font-mono text-meta text-ink-dim">
              · {agentChatCount} {agentChatCount === 1 ? 'chat' : 'chats'}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-small text-ink-muted">
          {agent.systemPrompt.trim() || (
            <span className="italic text-ink-dim">No system prompt set</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onEdit} size="sm" variant="outline">
          <Pencil className="size-3.5" /> Edit
        </Button>
        <Button onClick={onDelete} size="sm" variant="ghost">
          <Trash2 className="size-3.5 text-danger" />
          <span className="text-danger">Delete</span>
        </Button>
      </div>
    </article>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid gap-3 rounded-md border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
      <Bot className="mx-auto size-8 text-ink-muted" />
      <div>
        <p className="text-body font-semibold text-ink">No agents yet</p>
        <p className="mt-1 text-small text-ink-muted">
          Define an agent once and reuse it across DMs and channels. Each
          agent gets its own model and system prompt.
        </p>
      </div>
      <div>
        <Button onClick={onAdd} size="sm">
          <Plus className="size-4" />
          Create your first agent
        </Button>
      </div>
    </div>
  )
}

export function AgentsPageContent() {
  const agents = useLiveQuery(() => listAgents(), [], [] as Agent[])
  // Used to surface "deleting orphans an existing agent-DM" in the confirm
  // dialog. Live query so the count is always current.
  const agentChats = useLiveQuery(
    () => db.parentChats.where('agentId').notEqual('').toArray(),
    [],
    [] as ParentChat[],
  )

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = useState<Agent | undefined>(undefined)

  const openCreate = () => {
    setEditing(undefined)
    setEditorOpen(true)
  }
  const openEdit = (agent: Agent) => {
    setEditing(agent)
    setEditorOpen(true)
  }

  const pendingDeleteChatCount = pendingDelete
    ? agentChats.filter((chat) => chat.agentId === pendingDelete.id).length
    : 0

  return (
    <div className="p-6 md:p-10">
      <CardHeader className="px-0 pt-0">
        <Badge>Settings</Badge>
        <CardTitle className="text-3xl">Agents</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          Reusable participants with their own model and system prompt. Use
          them as direct-message partners or add them to channels.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 px-0 pb-0">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-heading font-semibold text-ink">Library</h3>
              <span className="font-mono text-meta text-ink-muted">
                {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
              </span>
            </div>
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" />
              Add agent
            </Button>
          </div>

          {agents.length === 0 ? (
            <EmptyState onAdd={openCreate} />
          ) : (
            <div className="grid gap-3">
              {agents.map((agent) => {
                const chatCount = agentChats.filter(
                  (chat) => chat.agentId === agent.id,
                ).length
                return (
                  <AgentRow
                    agent={agent}
                    agentChatCount={chatCount}
                    key={agent.id}
                    onDelete={() => setPendingDelete(agent)}
                    onEdit={() => openEdit(agent)}
                  />
                )
              })}
            </div>
          )}
        </section>
      </CardContent>

      <AgentEditor
        agent={editing}
        onOpenChange={setEditorOpen}
        open={editorOpen}
      />

      <ConfirmDialog
        body={
          <>
            {pendingDeleteChatCount > 0 ? (
              <>
                <p>
                  {pendingDeleteChatCount}{' '}
                  {pendingDeleteChatCount === 1 ? 'chat references' : 'chats reference'}{' '}
                  this agent. Those chats stay in your history, but won't be
                  able to send new messages until you reassign them.
                </p>
                <p className="mt-2">
                  Messages already sent keep their author identity.
                </p>
              </>
            ) : (
              <p>
                The agent will be removed from your library. Messages already
                sent keep their author identity.
              </p>
            )}
          </>
        }
        confirmLabel="Delete agent"
        destructive
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={async () => {
          if (!pendingDelete) return
          const id = pendingDelete.id
          setPendingDelete(undefined)
          await deleteAgent(id)
        }}
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete "${pendingDelete.displayName}"?` : ''}
      />
    </div>
  )
}
