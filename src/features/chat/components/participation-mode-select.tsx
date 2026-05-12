import type { ParticipationMode } from '@/features/chat/domain'

// Tiny inline select for channel participation modes. Used in the
// new-chat-modal and the channel-participants panel; kept in one place so
// new modes (regex/keyword/conditional, per docs/tasks.md) land in one diff.
export function ParticipationModeSelect({
  onChange,
  value,
}: {
  onChange: (mode: ParticipationMode) => void
  value: ParticipationMode
}) {
  return (
    <select
      className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-meta text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onChange={(event) => onChange(event.target.value as ParticipationMode)}
      value={value}
    >
      <option value="auto-decide">auto-decide</option>
      <option value="mention-only">mention-only</option>
    </select>
  )
}
