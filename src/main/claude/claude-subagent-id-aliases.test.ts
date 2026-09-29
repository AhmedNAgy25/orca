import { describe, expect, it } from 'vitest'
import type { AgentJournalProducerLinkage } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionLinkageJournal } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { ClaudeJournaledSubagentIds, ClaudeSubagentIds } from './claude-subagent-id-aliases'

describe('ClaudeSubagentIds', () => {
  it('resolves an aliased tool id to its task, and an unaliased id to itself', () => {
    const ids = new ClaudeSubagentIds()
    ids.alias('toolu_1', 'task-1')
    expect(ids.canonical('toolu_1')).toBe('task-1')
    expect(ids.canonical('toolu_unknown')).toBe('toolu_unknown')
  })

  it('remembers an exclusion under either of the ids that named it', () => {
    const ids = new ClaudeSubagentIds()
    ids.exclude('task-bash')
    expect(ids.isExcluded('toolu_bash', 'task-bash')).toBe(true)
    expect(ids.isExcluded(null, null)).toBe(false)
    expect(ids.isExcluded('task-agent')).toBe(false)
  })

  it('drops the oldest alias past the bound and keeps the newest', () => {
    const ids = new ClaudeSubagentIds()
    for (let index = 0; index <= 512; index += 1) {
      ids.alias(`toolu_${index}`, `task-${index}`)
    }
    // Evicted: the id now stands only for itself.
    expect(ids.canonical('toolu_0')).toBe('toolu_0')
    expect(ids.canonical('toolu_512')).toBe('task-512')
    expect(ids.canonical('toolu_1')).toBe('task-1')
  })

  it('drops the oldest exclusion past the bound and keeps the newest', () => {
    const ids = new ClaudeSubagentIds()
    for (let index = 0; index <= 512; index += 1) {
      ids.exclude(`task-${index}`)
    }
    expect(ids.isExcluded('task-0')).toBe(false)
    expect(ids.isExcluded('task-512')).toBe(true)
    expect(ids.isExcluded('task-1')).toBe(true)
  })

  it('does not retain oversized aliases or exclusions', () => {
    const ids = new ClaudeSubagentIds()
    const oversized = 'x'.repeat(513)
    ids.alias(oversized, 'task-1')
    ids.alias('tool-1', oversized)
    ids.exclude(oversized)
    expect(ids.canonical(oversized)).toBe(oversized)
    expect(ids.canonical('tool-1')).toBe('tool-1')
    expect(ids.isExcluded(oversized)).toBe(false)
  })

  it('forgets everything on clear', () => {
    const ids = new ClaudeSubagentIds()
    ids.alias('toolu_1', 'task-1')
    ids.exclude('task-1')
    ids.clear()
    expect(ids.canonical('toolu_1')).toBe('toolu_1')
    expect(ids.isExcluded('task-1')).toBe(false)
  })
})

function linkageJournal(
  epoch: string,
  rows: AgentJournalProducerLinkage[]
): StructuredAgentSessionLinkageJournal {
  return {
    epoch,
    visitItemLinkage: (visit) => rows.forEach(visit)
  }
}

describe('ClaudeSubagentIds with an earlier run journaled', () => {
  it("prefers what this run was told, and falls back to the earlier run's alias", () => {
    const ids = new ClaudeSubagentIds((toolUseId) =>
      toolUseId === 'toolu_spawn' || toolUseId === 'toolu_both' ? 'task-journaled' : null
    )
    ids.alias('toolu_both', 'task-live')
    expect(ids.canonical('toolu_both')).toBe('task-live')
    expect(ids.canonical('toolu_spawn')).toBe('task-journaled')
    expect(ids.isAnnounced('toolu_spawn')).toBe(true)
    expect(ids.isAnnounced('toolu_unknown')).toBe(false)
    expect(ids.canonical('toolu_unknown')).toBe('toolu_unknown')
  })
})

describe('ClaudeJournaledSubagentIds', () => {
  it('recalls only an agent row that resolved its reference to another id', () => {
    const journal = linkageJournal('epoch-1', [
      { agentId: 'task-a', providerParentRef: 'toolu_a', producerKind: 'agent' },
      // Stamped with its own reference: never resolved, so it names no alias.
      { agentId: 'toolu_raw', providerParentRef: 'toolu_raw', producerKind: 'agent' },
      // A backgrounded shell is not a subagent and never outlives its process.
      { agentId: 'shell-1', providerParentRef: 'toolu_shell', producerKind: 'background' },
      {}
    ])
    const recalled = new ClaudeJournaledSubagentIds(() => journal)
    expect(recalled.canonical('toolu_a')).toBe('task-a')
    expect(recalled.canonical('toolu_raw')).toBeNull()
    expect(recalled.canonical('toolu_shell')).toBeNull()
  })

  it('recalls nothing before the journal is bound, and does not keep that answer', () => {
    let bound: StructuredAgentSessionLinkageJournal | null = null
    const recalled = new ClaudeJournaledSubagentIds(() => bound)
    expect(recalled.canonical('toolu_a')).toBeNull()
    bound = linkageJournal('epoch-1', [
      { agentId: 'task-a', providerParentRef: 'toolu_a', producerKind: 'agent' }
    ])
    expect(recalled.canonical('toolu_a')).toBe('task-a')
  })

  it('re-reads the same journal once its epoch is replaced', () => {
    let rows: AgentJournalProducerLinkage[] = [
      { agentId: 'task-a', providerParentRef: 'toolu_a', producerKind: 'agent' }
    ]
    const journal: {
      epoch: string
      visitItemLinkage: StructuredAgentSessionLinkageJournal['visitItemLinkage']
    } = { epoch: 'epoch-1', visitItemLinkage: (visit) => rows.forEach(visit) }
    const recalled = new ClaudeJournaledSubagentIds(() => journal)
    expect(recalled.canonical('toolu_a')).toBe('task-a')
    rows = [{ agentId: 'task-b', providerParentRef: 'toolu_b', producerKind: 'agent' }]
    journal.epoch = 'epoch-2'
    expect(recalled.canonical('toolu_a')).toBeNull()
    expect(recalled.canonical('toolu_b')).toBe('task-b')
  })
})
