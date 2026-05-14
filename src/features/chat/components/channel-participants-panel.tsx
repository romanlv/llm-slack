import { useId, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AgentDot } from '@/features/agents/agent-dot'
import { AgentEditor } from '@/features/agents/agent-editor'
import { listAgents } from '@/features/agents/agents-repository'
import type { Agent, ChannelParticipant } from '@/features/chat/domain'
import {
  addChannelParticipant,
  listChannelParticipants,
  removeChannelParticipant,
  setChannelParticipantMode,
} from '@/features/chat/repository'

import { ParticipationModeSelect } from './participation-mode-select'

// Add/remove channel participants, edit each one's participation mode. Used
// inside the channel-settings dialog. Live-queried — every mutation lands
// directly on the DB and the panel re-renders.
export function ChannelParticipantsPanel({ chatId }: { chatId: string }) {
  const participants = useLiveQuery(
    () => listChannelParticipants(chatId),
    [chatId],
    [] as ChannelParticipant[],
  )
  const agents = useLiveQuery(() => listAgents(), [], [] as Agent[])
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const participantAgentIds = new Set(participants.map((p) => p.agentId))
  const candidateAgents = agents.filter((agent) => !participantAgentIds.has(agent.id))

  const [pendingAgentId, setPendingAgentId] = useState<string>('')
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>(undefined)
  const selectId = useId()

  const handleAdd = async () => {
    if (!pendingAgentId) {
      setError('Pick an agent to add.')
      return
    }
    setError('')
    try {
      await addChannelParticipant({ chatId, agentId: pendingAgentId })
      setPendingAgentId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add participant.')
    }
  }

  // When the agent editor saves a brand-new agent, drop it straight into this
  // channel so the user doesn't have to re-pick it from the dropdown. For
  // edits of an existing participant we leave the membership alone (the
  // editor surfaces the same flow from /settings/agents, where this would be
  // surprising).
  const handleAgentSaved = async (agent: Agent) => {
    if (participantAgentIds.has(agent.id)) return
    try {
      await addChannelParticipant({ chatId, agentId: agent.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add new agent to channel.')
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-heading font-semibold text-ink">Agents</h3>
        <p className="mt-1 text-small text-ink-muted">
          Add or remove participants and tune how each one decides to speak.
        </p>
      </div>

      {participants.length === 0 ? (
        <p className="rounded-md border border-dashed border-line bg-surface/60 px-4 py-6 text-center text-small text-ink-muted">
          No agents in this channel yet. Add one below to start the room.
        </p>
      ) : (
        <ul className="grid gap-2">
          {participants.map((participant) => {
            const agent = agentById.get(participant.agentId)
            const displayName = agent?.displayName ?? 'Deleted agent'
            return (
              <li
                className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2"
                key={participant.id}
              >
                <AgentDot
                  agentId={participant.agentId}
                  displayName={displayName}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-body font-semibold text-ink">
                    {displayName}
                    {!agent ? (
                      <span className="ml-2 font-mono text-meta text-ink-dim">
                        (removed from library)
                      </span>
                    ) : null}
                  </div>
                  {agent ? (
                    <div className="font-mono text-meta text-ink-muted">
                      {agent.model.providerModelId}
                    </div>
                  ) : null}
                </div>
                <ParticipationModeSelect
                  onChange={async (mode) => {
                    try {
                      await setChannelParticipantMode(chatId, participant.agentId, mode)
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : 'Could not update mode.',
                      )
                    }
                  }}
                  value={participant.mode}
                />
                {agent ? (
                  <Button
                    aria-label={`Edit ${displayName}`}
                    onClick={() => {
                      setEditingAgent(agent)
                      setEditorOpen(true)
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <Pencil className="size-3.5 text-ink-muted" />
                  </Button>
                ) : null}
                <Button
                  aria-label={`Remove ${displayName} from channel`}
                  onClick={() => removeChannelParticipant(chatId, participant.agentId)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5 text-danger" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="grid gap-2 rounded-md border border-line bg-canvas/40 px-3 py-3">
        <label
          className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
          htmlFor={selectId}
        >
          Add agent
        </label>
        {agents.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-small text-ink-muted">
            <span>No agents in your library yet.</span>
            <Button onClick={() => {
                setEditingAgent(undefined)
                setEditorOpen(true)
              }} size="sm">
              <UserPlus className="size-4" /> Create new agent
            </Button>
          </div>
        ) : (
          <>
            {candidateAgents.length === 0 ? (
              <p className="text-small text-ink-muted">
                Every agent in your library is already in this channel.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-small text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  id={selectId}
                  onChange={(event) => setPendingAgentId(event.target.value)}
                  value={pendingAgentId}
                >
                  <option value="">Pick an agent…</option>
                  {candidateAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                    </option>
                  ))}
                </select>
                <Button onClick={handleAdd} size="sm">
                  <Plus className="size-4" /> Add
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1 text-small text-ink-muted">
              <span>Need a different one?</span>
              <button
                className="inline-flex items-center gap-1.5 font-mono text-meta font-semibold text-accent transition hover:underline"
                onClick={() => {
                setEditingAgent(undefined)
                setEditorOpen(true)
              }}
                type="button"
              >
                <UserPlus className="size-3.5" /> Create new agent
              </button>
            </div>
          </>
        )}
      </div>

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-small text-danger">
          {error}
        </p>
      ) : null}

      <AgentEditor
        agent={editingAgent}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditingAgent(undefined)
        }}
        onSaved={(agent) => void handleAgentSaved(agent)}
        open={editorOpen}
      />
    </div>
  )
}
