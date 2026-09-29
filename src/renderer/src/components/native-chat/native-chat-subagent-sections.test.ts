import { describe, expect, it } from 'vitest'
import type {
  NativeChatMessage,
  NativeChatSubagentState
} from '../../../../shared/native-chat-types'
import { projectNativeChatTranscript } from '../../../../shared/native-chat-transcript-projection'
import { compareMessages } from './native-chat-session-assembler'
import {
  nativeChatRowsInTranscriptOrder,
  nativeChatSubagentRowsInOrder,
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

/** `choices`: the sections the reader opened (true) or closed (false) by hand. */
function slotsOf(
  rows: NativeChatMessage[],
  choices: Record<string, boolean> = {},
  isWorking = false
): NativeChatTranscriptSlot[] {
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
    isWorking,
    lifecycleWorking: false,
    subagentSections: sections,
    subagentSectionChoices: new Map(Object.entries(choices))
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

function transcriptWith(state: NativeChatSubagentState): NativeChatMessage[] {
  return [
    row('ask', say('review the PR'), { role: 'user' }),
    roster('spawn', [['task-1', 'explore the lane', state]]),
    row('child-look', say('Looking at the diff.'), by('task-1')),
    row('child-grep', call('Grep'), by('task-1')),
    row('answer', say('Delegated; the summary follows.')),
    row('child-verdict', say('The PR is CLEAN.'), by('task-1'))
  ]
}

const OPEN_UNDER_ROSTER = [
  'ask',
  'spawn',
  '[task-1 open]',
  '>child-look',
  '>child-verdict',
  'answer'
]

describe("a subagent's rows live in its own section", () => {
  const settled = transcriptWith('completed')

  it("draws none of a settled agent's rows until the reader opens it from its roster", () => {
    const slots = slotsOf(settled)
    expect(outline(slots)).toEqual(['ask', 'spawn', 'answer'])
    const spawn = slots[1]
    expect(spawn?.kind === 'message' ? spawn.subagentSections : null).toEqual(
      new Map([['task-1', false]])
    )
  })

  it('opens them under the roster that names the agent, headed by its name', () => {
    const slots = slotsOf(settled, { 'task-1': true })
    expect(outline(slots)).toEqual(OPEN_UNDER_ROSTER)
    const head = slots[2]
    expect(head?.kind === 'subagent' ? head.entry?.label : null).toBe('explore the lane')
    expect(new Set(slots.map(nativeChatSlotKey)).size).toBe(slots.length)
  })

  it("keeps the agent's own live frontier while the roster says it works", () => {
    const live = slotsOf(transcriptWith('working'), { 'task-1': true }).filter(
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

  it('places each section head in the turn it sits in, for the outline rail', () => {
    const rows = [
      row('ask-1', say('first'), { role: 'user' }),
      row('stray', say('Unlisted.'), by('toolu_9')),
      row('reply-1', say('done')),
      row('ask-2', say('review the PR'), { role: 'user' }),
      roster('spawn', [['task-1', 'explore the lane', 'completed']]),
      row('child-look', say('Looking.'), by('task-1')),
      row('answer', say('Done.'))
    ]
    const heads = slotsOf(rows, { 'task-1': true }).flatMap((slot) =>
      slot.kind === 'subagent' ? [[slot.agentId, slot.turnKey]] : []
    )
    expect(heads).toEqual([
      ['toolu_9', 'ask-1'],
      ['task-1', 'ask-2']
    ])
  })

  it("places a section's rows in the turn the section is shown in, not the turn each was written in", () => {
    const rows = [
      row('ask-1', say('review the PR'), { role: 'user' }),
      roster('spawn', [['task-1', 'explore the lane', 'working']]),
      row('child-look', say('Looking.'), by('task-1')),
      row('reply-1', say('Started a reviewer.')),
      row('ask-2', say('and the tests?'), { role: 'user' }),
      row('child-later', say('Still looking.'), by('task-1')),
      row('grandchild-read', say('Reading one file.'), by('task-2', 'task-1')),
      row('reply-2', say('Running them.'))
    ]
    const turns = slotsOf(rows, { 'task-1': true, 'task-2': true }).map((slot) => [
      slot.kind === 'message' ? slot.message.id : `[${slot.agentId}]`,
      slot.turnKey
    ])
    expect(turns).toEqual([
      ['ask-1', 'ask-1'],
      ['spawn', 'ask-1'],
      ['[task-1]', 'ask-1'],
      ['child-look', 'ask-1'],
      ['child-later', 'ask-1'],
      ['[task-2]', 'ask-1'],
      ['grandchild-read', 'ask-1'],
      ['reply-1', 'ask-1'],
      ['ask-2', 'ask-2'],
      ['reply-2', 'ask-2']
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
    // No roster says whether it works, so nothing opens it but the reader.
    expect(outline(slotsOf(unlisted))).toEqual(['ask', 'delegate', '[toolu_1]', 'answer'])
    expect(outline(slotsOf(unlisted, { toolu_1: true }))).toEqual([
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
      ...settled,
      row('grandchild-read', say('Reading one file.'), by('task-2', 'task-1')),
      row('child-last', say('Wrapping up.'), by('task-1'))
    ]
    expect(outline(slotsOf(nested, { 'task-1': true }))).toEqual([
      'ask',
      'spawn',
      '[task-1 open]',
      '>child-look',
      '>child-verdict',
      '>[task-2]',
      '>child-last',
      'answer'
    ])
    expect(outline(slotsOf(nested, { 'task-1': true, 'task-2': true })).slice(5, 7)).toEqual([
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

describe("a subagent's section is open while it is the session's live frontier", () => {
  // The parent waits on the agent: nothing it said or did comes after the roster.
  const waiting = (state: NativeChatSubagentState) => [
    row('ask', say('review the PR'), { role: 'user' }),
    roster('spawn', [['task-1', 'explore the lane', state]]),
    row('child-look', say('Looking at the diff.'), by('task-1')),
    row('child-verdict', say('The PR is CLEAN.'), by('task-1'))
  ]
  const OPEN_AT_FRONTIER = ['ask', 'spawn', '[task-1 open]', '>child-look', '>child-verdict']

  it('opens while its roster is the newest thing the running session produced', () => {
    expect(outline(slotsOf(waiting('working'), {}, true))).toEqual(OPEN_AT_FRONTIER)
    // A settled agent still at the frontier stays open until the parent moves on.
    expect(outline(slotsOf(waiting('completed'), {}, true))).toEqual(OPEN_AT_FRONTIER)
  })

  it('ignores a user row after the roster', () => {
    const rows = [...waiting('working'), row('follow-up', say('and?'), { role: 'user' })]
    expect(outline(slotsOf(rows, {}, true)).slice(0, 3)).toEqual(['ask', 'spawn', '[task-1 open]'])
  })

  it('closes once the parent produces anything newer, though the agent still works', () => {
    expect(outline(slotsOf(transcriptWith('working'), {}, true))).toEqual([
      'ask',
      'spawn',
      'answer'
    ])
  })

  it('stays closed while the session is not running', () => {
    expect(outline(slotsOf(waiting('working')))).toEqual(['ask', 'spawn'])
  })

  it("keeps the reader's choice over the frontier, in either direction", () => {
    expect(outline(slotsOf(waiting('working'), { 'task-1': false }, true))).toEqual([
      'ask',
      'spawn'
    ])
    expect(outline(slotsOf(transcriptWith('working'), { 'task-1': true }, true))).toEqual(
      OPEN_UNDER_ROSTER
    )
  })

  it("opens a grandchild at its working spawner's frontier, and not once the spawner moves on or settles", () => {
    const nested = (spawner: NativeChatSubagentState, spawnerMovesOn: boolean) => [
      row('ask', say('go'), { role: 'user' }),
      roster('spawn', [['task-1', 'lead the review', spawner]]),
      row('child-look', say('Delegating a read.'), by('task-1')),
      roster('spawn-2', [['task-2', 'read one file', 'working']]),
      row('grandchild-read', say('Reading one file.'), by('task-2', 'task-1')),
      ...(spawnerMovesOn ? [row('child-last', say('Reading another.'), by('task-1'))] : [])
    ]
    const grandchild = (rows: NativeChatMessage[]) =>
      outline(slotsOf(rows, { 'task-1': true }, true)).find((line) => line.includes('task-2'))
    expect(grandchild(nested('working', false))).toBe('>[task-2 open]')
    expect(grandchild(nested('working', true))).toBe('>[task-2]')
    // A settled spawner closes its scope: nothing inside it is live.
    expect(grandchild(nested('completed', false))).toBe('>[task-2]')
  })
})

describe("a subagent's edits in its turn's changed files", () => {
  const patch = { path: 'src/a.ts' }
  const edit = [
    { type: 'tool-call' as const, name: 'Diff', input: patch, state: 'completed' as const },
    { type: 'tool-result' as const, output: '@@ -1 +1 @@\n-before\n+after' }
  ]

  it('counts the edit in the turn it was made, pointing at the subagent row and its section', () => {
    const { conversation, sections } = sectionsOf([
      row('ask', say('edit it'), { role: 'user' }),
      roster('spawn', [['task-1', 'editor', 'completed']]),
      row('child-edit', edit, by('task-1')),
      row('answer', say('Done.'))
    ])
    const turnKeys = conversation.map(() => 'ask')
    const rows = nativeChatRowsInTranscriptOrder(
      conversation,
      turnKeys,
      nativeChatSubagentRowsInOrder(sections.rows)
    )
    expect(rows.messages.map((message) => message.id)).toEqual([
      'ask',
      'spawn',
      'child-edit',
      'answer'
    ])
    const diff = nativeChatTurnDiffs(rows.messages, rows.turnKeys, sections.pathOf).get('ask')
    expect(diff?.files.map((file) => file.target)).toEqual([
      { messageId: 'child-edit', editKey: 'Diff:0', fileIndex: 0, subagentSections: ['task-1'] }
    ])
  })
})
