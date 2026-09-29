import { describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import { readStructuredJournalPage } from './structured-worker-journal-page'

function item(
  itemId: string,
  text: string,
  linkage: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  return {
    itemId,
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] },
    ...linkage
  }
}

const journal = vi.hoisted(() => {
  const state: { items: AgentJournalRenderItem[] } = { items: [] }
  return state
})

vi.mock('../../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => ({
    history: async () => ({ page: { items: journal.items, hasOlder: true } })
  })
}))

describe("a worker's journal page", () => {
  it("holds the worker's own rows and never a subagent's", async () => {
    journal.items = [
      item('own', 'Delegating the review.'),
      item('child', 'The PR is CLEAN.', { agentId: 'task-1', producerKind: 'agent' }),
      item('grandchild', 'Looked at one file.', { agentId: 'task-2', parentAgentId: 'task-1' }),
      item('answer', 'The review found nothing.')
    ]

    const page = await readStructuredJournalPage('session-1')

    expect(page?.items.map((entry) => entry.itemId)).toEqual(['own', 'answer'])
    expect(page?.hasOlder).toBe(true)
  })
})
