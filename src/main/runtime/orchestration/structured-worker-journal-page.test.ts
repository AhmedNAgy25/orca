import { afterEach, describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/structured-agent-session-registry'
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

describe("a worker's journal page", () => {
  afterEach(() => setStructuredAgentSessionHost(null))

  it("holds the worker's own rows and never a subagent's", async () => {
    const items = [
      item('own', 'Delegating the review.'),
      item('child', 'The PR is CLEAN.', { agentId: 'task-1', producerKind: 'agent' }),
      item('grandchild', 'Looked at one file.', { agentId: 'task-2', parentAgentId: 'task-1' }),
      item('answer', 'The review found nothing.')
    ]
    setStructuredAgentSessionHost({
      history: async () => ({ page: { items, hasOlder: true } })
    } as never)

    const page = await readStructuredJournalPage('session-1')

    expect(page?.items.map((entry) => entry.itemId)).toEqual(['own', 'answer'])
    expect(page?.hasOlder).toBe(true)
  })
})
