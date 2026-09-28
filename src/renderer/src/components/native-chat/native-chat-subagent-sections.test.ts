import { describe, expect, it } from 'vitest'
import type {
  NativeChatMessage,
  NativeChatSubagentState
} from '../../../../shared/native-chat-types'
import { projectNativeChatTranscript } from '../../../../shared/native-chat-transcript-projection'
import { compareMessages } from './native-chat-session-assembler'
import {
  nativeChatRowsInTranscriptOrder,
  nativeChatSubagentSections
} from './native-chat-subagent-sections'
import {
  buildNativeChatTranscriptSlots,
  nativeChatSlotKey,
  type NativeChatTranscriptSlot
} from './native-chat-transcript-slots'
import { nativeChatTurnDiffs } from './native-chat-turn-diffs'

let sequence = 0

function row(
  id: string,
  blocks: NativeChatMessage['blocks'],
  overrides: Partial<NativeChatMessage> = {}
): NativeChatMessage {
  sequence += 1
  return {
    id,
    role: 'assistant',
    blocks,
    timestamp: 1,
    source: 'transcript',
    journalPosition: { sequence, index: 0 },
    ...overrides
  }
}

const say = (value: string) => [{ type: 'text' as const, text: value }]
const call = (name: string) => [{ type: 'tool-call' as const, name, input: {} }]
const by = (agentId: string, parentAgentId?: string) => ({
  agentId,
  producerKind: 'agent' as const,
  ...(parentAgentId === undefined ? {} : { parentAgentId })
})

function roster(id: string, agents: [string, string, NativeChatSubagentState][]) {
  return row(
    id,
    [
      {
        type: 'subagent-group',
        groupId: `group-${id}`,
        agents: agents.map(([agentId, label, state]) => ({ id: agentId, label, state }))
      }
    ],
    { role: 'system' }
  )
}

function sectionsOf(rows: NativeChatMessage[]) {
  const { conversation, subagentRows } = projectNativeChatTranscript(rows, compareMessages)
  return { conversation, sections: nativeChatSubagentSections(conversation, subagentRows) }
}

function slotsOf(rows: NativeChatMessage[], expanded: string[] = []): NativeChatTranscriptSlot[] {
  const { conversation, sections } = sectionsOf(rows)
  let turn: string | undefined
  const turnKeys = conversation.map((message) => {
    if (message.role === 'user') {
      turn = message.id
    }
    return turn
  })
  return buildNativeChatTranscriptSlots({
    messages: conversation,
    turnKeys,
    latestUserIndex: conversation.findLastIndex((message) => message.role === 'user'),
    currentTurnKey: undefined,
    receipts: new Map(),
    turnStatuses: { active: null, completedByTurn: {} },
    turnDiffs: new Map(),
    showTurnStatus: true,
    expandedTurnKeys: new Set(),
    isWorking: false,
    lifecycleWorking: false,
    subagentSections: sections,
    expandedSubagentIds: new Set(expanded)
  })
}

/** One line per slot: `>` per section it sits in, then the row id or `[agent]` for a head. */
function outline(slots: readonly NativeChatTranscriptSlot[]): string[] {
  return slots.map((slot) =>
    slot.kind === 'message'
      ? `${'>'.repeat(slot.depth)}${slot.message.id}`
      : `${'>'.repeat(slot.depth)}[${slot.agentId}${slot.expanded ? ' open' : ''}]`
  )
}

describe("a subagent's rows live in its own section", () => {
  const transcript = [
    row('ask', say('review the PR'), { role: 'user' }),
    roster('spawn', [['task-1', 'explore the lane', 'working']]),
    row('child-look', say('Looking at the diff.'), by('task-1')),
    row('child-grep', call('Grep'), by('task-1')),
    row('answer', say('Delegated; the summary follows.')),
    row('child-verdict', say('The PR is CLEAN.'), by('task-1'))
  ]

  it('draws none of them until the reader opens the agent from its roster', () => {
    const slots = slotsOf(transcript)
    expect(outline(slots)).toEqual(['ask', 'spawn', 'answer'])
    const spawn = slots[1]
    expect(spawn?.kind === 'message' ? spawn.subagentSections : null).toEqual(
      new Map([['task-1', false]])
    )
  })

  it('opens them under the roster that names the agent, headed by its name', () => {
    const slots = slotsOf(transcript, ['task-1'])
    expect(outline(slots)).toEqual([
      'ask',
      'spawn',
      '[task-1 open]',
      '>child-look',
      '>child-verdict',
      'answer'
    ])
    const head = slots[2]
    expect(head?.kind === 'subagent' ? head.entry?.label : null).toBe('explore the lane')
    expect(new Set(slots.map(nativeChatSlotKey)).size).toBe(slots.length)
  })

  it("keeps the agent's own live frontier while the roster says it works", () => {
    const live = slotsOf(transcript, ['task-1']).filter(
      (slot) => slot.kind === 'message' && slot.trailingRun
    )
    expect(
      live.map((slot) =>
        slot.kind === 'message' ? [slot.message.id, slot.activeTurnIsWorking] : []
      )
    ).toEqual([
      ['child-verdict', true],
      ['answer', false]
    ])
  })

  it('opens an agent no loaded roster names where its first row happened', () => {
    const unlisted = [
      row('ask', say('go'), { role: 'user' }),
      row('delegate', say('Delegating.')),
      row('orphan-look', say('Looking.'), by('toolu_1')),
      row('answer', say('Done.')),
      row('orphan-more', say('Still looking.'), by('toolu_1'))
    ]
    expect(outline(slotsOf(unlisted))).toEqual(['ask', 'delegate', '[toolu_1]', 'answer'])
    expect(outline(slotsOf(unlisted, ['toolu_1']))).toEqual([
      'ask',
      'delegate',
      '[toolu_1 open]',
      '>orphan-look',
      '>orphan-more',
      'answer'
    ])
  })

  it("opens a grandchild no roster names inside its spawner's section", () => {
    const nested = [
      ...transcript,
      row('grandchild-read', say('Reading one file.'), by('task-2', 'task-1')),
      row('child-last', say('Wrapping up.'), by('task-1'))
    ]
    expect(outline(slotsOf(nested, ['task-1']))).toEqual([
      'ask',
      'spawn',
      '[task-1 open]',
      '>child-look',
      '>child-verdict',
      '>[task-2]',
      '>child-last',
      'answer'
    ])
    expect(outline(slotsOf(nested, ['task-1', 'task-2'])).slice(5, 7)).toEqual([
      '>[task-2 open]',
      '>>grandchild-read'
    ])
    expect(sectionsOf(nested).sections.pathOf.get('grandchild-read')).toEqual(['task-1', 'task-2'])
  })

  it('opens agents whose spawners name each other in the conversation', () => {
    const looped = [
      row('ask', say('go'), { role: 'user' }),
      row('a-row', say('A.'), by('task-a', 'task-b')),
      row('b-row', say('B.'), by('task-b', 'task-a'))
    ]
    expect(outline(slotsOf(looped))).toEqual(['ask', '[task-a]', '[task-b]'])
  })
})

describe("a subagent's edits in its turn's changed files", () => {
  const patch = { path: 'src/a.ts' }
  const edit = [
    { type: 'tool-call' as const, name: 'Diff', input: patch, state: 'completed' as const },
    { type: 'tool-result' as const, output: '@@ -1 +1 @@\n-before\n+after' }
  ]

  it('counts the edit in the turn it was made, pointing at the subagent row', () => {
    const { conversation, sections } = sectionsOf([
      row('ask', say('edit it'), { role: 'user' }),
      roster('spawn', [['task-1', 'editor', 'completed']]),
      row('child-edit', edit, by('task-1')),
      row('answer', say('Done.'))
    ])
    const turnKeys = conversation.map(() => 'ask')
    const rows = nativeChatRowsInTranscriptOrder(conversation, turnKeys, sections)
    expect(rows.messages.map((message) => message.id)).toEqual([
      'ask',
      'spawn',
      'child-edit',
      'answer'
    ])
    const diff = nativeChatTurnDiffs(rows.messages, rows.turnKeys).get('ask')
    expect(diff?.files.map((file) => [file.path, file.target.messageId])).toEqual([
      ['src/a.ts', 'child-edit']
    ])
  })
})
