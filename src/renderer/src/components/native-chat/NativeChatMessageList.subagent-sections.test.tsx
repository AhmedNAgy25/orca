// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalProducerLinkage,
  AgentJournalRenderItem
} from '../../../../shared/agent-session-journal-types'
import type { NativeChatSubagentState } from '../../../../shared/native-chat-types'
import { projectStructuredItemsToNativeChat } from '../../../../shared/structured-agent-session-projection'
import {
  foldStructuredAgentSubagentRoster,
  NO_STRUCTURED_AGENT_SUBAGENT_ROSTER
} from '../../../../shared/structured-agent-session-subagent-roster'
import { NativeChatMessageList } from './NativeChatMessageList'
import { session, stubLayout } from './native-chat-windowing-test-harness'

afterEach(cleanup)

function journalItem(
  itemId: string,
  body: AgentJournalItemBody,
  sequence: number,
  linkage: AgentJournalProducerLinkage = {}
): AgentJournalRenderItem {
  return { itemId, body, sequence, observedAt: sequence * 1000, revision: 1, ...linkage }
}

const child: AgentJournalProducerLinkage = { agentId: 'task-1', producerKind: 'agent' }
const patch = '@@ -1 +1 @@\n-before\n+after'
const itemsWith = (state: NativeChatSubagentState, answered: boolean): AgentJournalRenderItem[] => [
  journalItem(
    'ask',
    { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Review it' }] },
    1
  ),
  journalItem(
    'spawn',
    {
      kind: 'message',
      role: 'system',
      blocks: [
        {
          type: 'subagent-group',
          groupId: 'group-1',
          agents: [{ id: 'task-1', label: 'explore the lane', state }]
        }
      ]
    },
    2
  ),
  journalItem(
    'child-said',
    { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'The PR is CLEAN.' }] },
    3,
    child
  ),
  journalItem(
    'child-edit',
    {
      kind: 'diff',
      path: 'src/a.ts',
      patch: { head: patch, truncated: false, digest: 'fixture', byteLength: patch.length }
    },
    4,
    child
  ),
  ...(answered
    ? [
        journalItem(
          'answer',
          {
            kind: 'message',
            role: 'assistant',
            blocks: [{ type: 'text', text: 'Delegated; nothing to fix.' }]
          },
          5
        )
      ]
    : [])
]

/** `waiting`: the session runs and has produced nothing since the roster. */
function listOf(state: NativeChatSubagentState, waiting = false): React.JSX.Element {
  const items = itemsWith(state, !waiting)
  return (
    <NativeChatMessageList
      session={session(projectStructuredItemsToNativeChat(items))}
      journalItems={items}
      isWorking={waiting}
      expandSignal={false}
      fontScale={1}
    />
  )
}

const renderList = () => render(listOf('completed'))

describe("a subagent's rows in the transcript", () => {
  let restoreLayout = (): void => {}
  beforeEach(() => {
    restoreLayout = stubLayout()
  })
  afterEach(() => {
    restoreLayout()
    vi.restoreAllMocks()
  })

  it("shows the conversation and none of the subagent's words until its section opens", () => {
    renderList()
    expect(screen.getByText('Delegated; nothing to fix.')).toBeInTheDocument()
    expect(screen.queryByText('The PR is CLEAN.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Ran 1 subagent/ }))
    const entry = screen.getByRole('button', { name: /explore the lane/, expanded: false })
    fireEvent.click(entry)

    expect(screen.getByText('The PR is CLEAN.')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /explore the lane/, expanded: true })
    ).toHaveLength(2)
  })

  it("still counts the subagent's edit in the turn, and reveals it inside its section", () => {
    vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {})
    renderList()
    expect(screen.queryByText('Edited file')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /1 changed file/ }))
    fireEvent.click(screen.getByRole('button', { name: /src\/a.ts/ }))

    expect(screen.getByText('Edited file')).toBeInTheDocument()
    expect(screen.getByText('The PR is CLEAN.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /explore the lane/, expanded: true })
    ).toBeInTheDocument()
  })

  it('opens a working subagent while the session waits on it, and closes it once the parent moves on', () => {
    const { rerender } = render(listOf('working', true))
    expect(screen.getByText('The PR is CLEAN.')).toBeInTheDocument()
    rerender(listOf('working'))
    expect(screen.queryByText('The PR is CLEAN.')).toBeNull()
    // The closed roster still says the agent works.
    expect(screen.getByRole('button', { name: /Kicked off 1 subagent/ })).toBeInTheDocument()
  })

  it("keeps the reader's choice over the frontier, in either direction", () => {
    const { rerender } = render(listOf('working', true))
    fireEvent.click(screen.getByRole('button', { name: /explore the lane/, expanded: true }))
    rerender(listOf('working', true))
    expect(screen.queryByText('The PR is CLEAN.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Kicked off 1 subagent/ }))
    fireEvent.click(screen.getByRole('button', { name: /explore the lane/, expanded: false }))
    rerender(listOf('working'))
    expect(screen.getByText('The PR is CLEAN.')).toBeInTheDocument()
  })

  it('names a section from the client roster when its roster row is not loaded', () => {
    const items = itemsWith('completed', true)
    const loaded = items.filter((next) => next.itemId !== 'spawn')
    render(
      <NativeChatMessageList
        session={session(projectStructuredItemsToNativeChat(loaded))}
        journalItems={loaded}
        subagentRoster={foldStructuredAgentSubagentRoster(
          NO_STRUCTURED_AGENT_SUBAGENT_ROSTER,
          items
        )}
        isWorking={false}
        expandSignal={false}
        fontScale={1}
      />
    )
    expect(screen.getByRole('button', { name: /explore the lane/, expanded: false })).toBeVisible()
  })
})
