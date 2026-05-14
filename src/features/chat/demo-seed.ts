// Declarative spec for the first-run demo data: a multi-agent channel with
// a small cast and a pre-baked exchange that shows the collective dynamic.
//
// Edit this file — and only this file — to iterate on what new users see.
// The builder lives in `repository.ts` (`seedParentChatIfNeeded`) and calls
// the public repository APIs (`createAgent`, `createChannel`,
// `setChannelSettings`) so adding new required fields to Agent or
// ChannelSettings flows through here automatically.
//
// Schema-change safety: `DemoAgentSpec` is pinned to `Agent` via `Pick`, so
// a new required identity field on `Agent` causes a TypeScript error here.
// Defaultable character fields are absorbed by `agentDefaults` in
// `defaults.ts` and need no update.

import type { Agent, ChattinessLevel } from './domain'
import type { ModelRef } from '@/features/providers/model-ref'

export type DemoAgentSpec = Pick<
  Agent,
  'displayName' | 'username' | 'model' | 'systemPrompt' | 'chattiness'
>

// One demo message. `from` is 'user' for the human speaker, or a `username`
// that must exist in `agents`. `thread`, when present, bakes a real
// message-level thread rooted at this message — the builder derives the
// reply count from the array length so it cannot drift.
export interface DemoMessageSpec {
  from: 'user' | string
  content: string
  thread?: DemoThreadMessageSpec[]
}

export type DemoThreadMessageSpec = Omit<DemoMessageSpec, 'thread'>

export interface DemoChannelSpec {
  title: string
  description: string
  // House rules — the channel-wide system prompt.
  systemPrompt: string
}

export interface DemoSeed {
  channel: DemoChannelSpec
  agents: DemoAgentSpec[]
  messages: DemoMessageSpec[]
}

// Model refs intentionally omit `providerId` so they resolve to whichever
// connection of that kind the user has (or will) configure. Picked from
// the bundled catalogs in `src/features/providers/adapters/*` — keep in
// sync if those bundled lists are renamed.
const PLANNER_MODEL: ModelRef = {
  providerKind: 'openai',
  providerModelId: 'gpt-5.5',
}
const CRITIC_MODEL: ModelRef = {
  providerKind: 'anthropic',
  providerModelId: 'claude-opus-4-7',
}
const BEGINNER_MODEL: ModelRef = {
  providerKind: 'anthropic',
  providerModelId: 'claude-haiku-4-5-20251001',
}

const BALANCED: ChattinessLevel = 3
const ENGAGED: ChattinessLevel = 4
const RESERVED: ChattinessLevel = 2

export const demoSeed: DemoSeed = {
  channel: {
    title: 'brainstorm',
    description:
      'A round table for thinking through ideas with multiple AIs. Try editing the agents, or @-mention anyone to bring them in.',
    systemPrompt:
      'Disagree productively. Keep replies short — 2–3 sentences is plenty. Use threads for tangents.',
  },
  agents: [
    {
      displayName: 'Planner',
      username: 'planner',
      model: PLANNER_MODEL,
      chattiness: BALANCED,
      systemPrompt:
        'You break ideas into concrete steps and surface what is missing. Prefer brevity over completeness — the goal is to move the conversation forward, not to be thorough.',
    },
    {
      displayName: 'Critic',
      username: 'critic',
      model: CRITIC_MODEL,
      chattiness: ENGAGED,
      systemPrompt:
        'You stress-test ideas by looking for failure modes, contradictions, and unstated assumptions. Be direct but constructive — name the weakness, then suggest a sharper version.',
    },
    {
      displayName: 'Beginner',
      username: 'beginner',
      model: BEGINNER_MODEL,
      chattiness: RESERVED,
      systemPrompt:
        'You ask the simple questions everyone else assumes the answer to. Speak only when something genuinely does not make sense, or when a step has been skipped. Stay silent the rest of the time.',
    },
  ],
  messages: [
    {
      from: 'user',
      content:
        'I want to start a weekly habit of writing for 30 minutes. How do I make it stick?',
    },
    {
      from: 'planner',
      content:
        'Three concrete moves: pin a fixed time, lower the bar (say 100 words rather than polished prose), and track weeks completed instead of streaks. Start tomorrow, not Monday.',
      thread: [
        {
          from: 'user',
          content:
            'Tell me more about lowering the bar — what if 100 words still feels like too much?',
        },
        {
          from: 'planner',
          content:
            'Then go smaller — one sentence is fine. The point is making the action too small to skip. Once you sit down, the bar is already behind you and you usually keep writing.',
        },
      ],
    },
    {
      from: 'critic',
      content:
        'Streaks tend to backfire — one miss feels like failure and you quit. A monthly target (e.g., 4 out of 5 weeks) is more forgiving and just as effective. Also: 30 min is a long block to defend; 10 min lowers the activation cost a lot.',
    },
    {
      from: 'beginner',
      content: 'What do you actually write about when you sit down?',
    },
  ],
}
