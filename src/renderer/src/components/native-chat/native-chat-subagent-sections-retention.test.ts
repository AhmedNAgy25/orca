import { describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalProducerLinkage,
  AgentJournalRenderItem
} from '../../../../shared/agent-session-journal-types'
import type { AgentSessionHistoryPage } from '../../../../shared/agent-session-wire'
import { projectNativeChatTranscript } from '../../../../shared/native-chat-transcript-projection'
import { projectStructuredItemsToNativeChat } from '../../../../shared/structured-agent-session-projection'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession,
  type StructuredAgentSessionState
} from '../../../../shared/structured-agent-session-reducer'
import { compareMessages } from './native-chat-session-assembler'
import { nativeChatSubagentSections } from './native-chat-subagent-sections'

// The live window the renderer draws sections from, through the real reducer: a
// subagent's burst must not trim away the roster row that names its section.

const child: AgentJournalProducerLinkage = { agentId: 'task-1', producerKind: 'agent' }

function item(
  itemId: string,
  sequence: number,
  body: AgentJournalItemBody,
  linkage: AgentJournalProducerLinkage = {}
): AgentJournalRenderItem {
  return { itemId, revision: 1, sequence, observedAt: sequence, body, ...linkage }
}

const said = (role: 'user' | 'assistant', text: string): AgentJournalItemBody => ({
  kind: 'message',
  role,
  blocks: [{ type: 'text', text }]
})

const rosterBody: AgentJournalItemBody = {
  kind: 'message',
  role: 'system',
  blocks: [
    {
      type: 'subagent-group',
      groupId: 'group-1',
      agents: [{ id: 'task-1', label: 'review the PR', state: 'working' }]
    }
  ]
}

function snapshot(items: AgentJournalRenderItem[]): StructuredAgentSessionState {
  const newest = items.at(-1)?.sequence ?? 0
  const page: AgentSessionHistoryPage = {
    sessionId: 'session-a',
    epoch: 'epoch-a',
    direction: 'tail',
    items,
    removedItemIds: [],
    submissions: [],
    window: {
      oldest: { epoch: 'epoch-a', sequence: items[0]?.sequence ?? 0 },
      newest: { epoch: 'epoch-a', sequence: newest },
      nextCursor: { epoch: 'epoch-a', sequence: items[0]?.sequence ?? 0 }
    },
    liveCursor: { epoch: 'epoch-a', sequence: newest },
    hasOlder: false,
    hasNewer: false
  }
  return reduceStructuredAgentSession(EMPTY_STRUCTURED_AGENT_SESSION, {
    type: 'event',
    event: { type: 'snapshot', sessionId: 'session-a', fence: 1, page }
  })
}

function stream(
  state: StructuredAgentSessionState,
  items: AgentJournalRenderItem[]
): StructuredAgentSessionState {
  return items.reduce(
    (current, next) =>
      reduceStructuredAgentSession(current, {
        type: 'event',
        event: {
          type: 'batch',
          sessionId: 'session-a',
          batch: {
            cursor: { epoch: 'epoch-a', sequence: next.sequence },
            items: [next],
            removedItemIds: [],
            submissions: []
          }
        }
      }),
    state
  )
}

function sectionsOf(state: StructuredAgentSessionState) {
  const messages = projectStructuredItemsToNativeChat(state.items)
  const { conversation, subagentRows } = projectNativeChatTranscript(messages, compareMessages)
  return { conversation, sections: nativeChatSubagentSections(conversation, subagentRows) }
}

describe('subagent sections over the live retained window', () => {
  it("keeps a working subagent's section named, under its roster, through a long burst", () => {
    const opened = snapshot([
      item('prompt', 1, said('user', 'review the PR')),
      item('roster', 2, rosterBody)
    ])
    const burst = Array.from({ length: 1_500 }, (_, index) =>
      item(`child-${index}`, index + 3, said('assistant', `step ${index}`), child)
    )

    const { conversation, sections } = sectionsOf(stream(opened, burst))

    expect(sections.entries.get('task-1')?.label).toBe('review the PR')
    expect(sections.anchoredAt.get('roster')).toEqual(['task-1'])
    expect(sections.openAt.get(null)).toBeUndefined()
    expect(conversation.map((message) => message.id)).toEqual(['prompt', 'roster'])
  })
})
