import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from './native-chat-types'
import {
  projectNativeChatTranscript,
  projectNativeChatTranscriptMessages
} from './native-chat-transcript-projection'

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
const child = { agentId: 'task-1', producerKind: 'agent' as const }

describe("a subagent's rows are not the conversation's", () => {
  // The shape a background subagent leaves: its rows interleave with its parent's.
  const transcript = [
    row('ask', say('review the PR'), { role: 'user' }),
    row('delegate', say('Delegating the review.')),
    row('child-look', say('Looking at the diff.'), child),
    row('parent-read', call('Read')),
    row('child-grep', call('Grep'), child),
    row('child-verdict', say('The PR is CLEAN.'), child),
    row('answer', say('The review found nothing.'))
  ]

  it("keeps the session's own rows as the conversation, and none of the subagent's", () => {
    const { conversation, subagentRows } = projectNativeChatTranscript(transcript)
    expect(conversation.map((message) => message.id)).toEqual(['ask', 'delegate', 'answer'])
    expect(conversation[1]?.blocks).toEqual([...say('Delegating the review.'), ...call('Read')])
    expect(
      subagentRows.get('task-1')?.map(({ message, turnKey }) => [message.id, turnKey])
    ).toEqual([
      ['child-look', 'ask'],
      ['child-verdict', 'ask']
    ])
    expect(projectNativeChatTranscriptMessages(transcript)).toEqual(conversation)
  })

  it("folds the subagent's calls into its own run however its parent's interleave", () => {
    const [look] = projectNativeChatTranscript(transcript).subagentRows.get('task-1') ?? []
    expect(look?.message.blocks).toEqual([...say('Looking at the diff.'), ...call('Grep')])
  })

  it('splits a subagent run at the turn it crossed, so each call stays in its own turn', () => {
    const rows = projectNativeChatTranscript([
      row('first', say('go'), { role: 'user' }),
      row('child-start', say('Starting.'), child),
      row('second', say('and then'), { role: 'user' }),
      row('child-edit', call('Edit'), child)
    ]).subagentRows.get('task-1')
    expect(rows?.map(({ message, turnKey }) => [message.id, turnKey])).toEqual([
      ['child-start', 'first'],
      ['child-edit', 'second']
    ])
  })

  // Main's grouping rule, not position: a send made mid-turn does not own the rows
  // written before its own turn opened, and a turn keyed to its record owns its rows.
  it("takes each row's turn from the host's attribution, as the conversation's rows do", () => {
    const rows = [
      row('first', say('go'), { role: 'user' }),
      row('child-start', say('Starting.'), child),
      row('second', say('and then'), { role: 'user' }),
      row('child-edit', call('Edit'), child),
      row('child-woke', call('Write'), child)
    ]
    const owned = new Map([
      ['first', 'first'],
      ['child-start', 'first'],
      ['second', 'second'],
      ['child-edit', 'first'],
      ['child-woke', 'turn-3-record']
    ])
    const projected = projectNativeChatTranscript(rows, undefined, owned).subagentRows.get('task-1')
    expect(projected?.map(({ message, turnKey }) => [message.id, turnKey])).toEqual([
      ['child-start', 'first'],
      ['child-woke', 'turn-3-record']
    ])
    expect(projected?.[0]?.message.blocks).toEqual([...say('Starting.'), ...call('Edit')])
  })

  it("never lets a subagent's own prompt open a conversation turn", () => {
    const rows = projectNativeChatTranscript([
      row('ask', say('go'), { role: 'user' }),
      row('child-prompt', say('Review the diff.'), { ...child, role: 'user' }),
      row('child-look', say('Looking.'), child)
    ]).subagentRows.get('task-1')
    expect(rows?.every(({ turnKey }) => turnKey === 'ask')).toBe(true)
  })

  it('projects a transcript that names no producer exactly as before', () => {
    const plain = transcript.map(({ agentId: _agentId, producerKind: _kind, ...rest }) => rest)
    const { conversation, subagentRows } = projectNativeChatTranscript(plain)
    expect(subagentRows.size).toBe(0)
    expect(conversation.map((message) => message.id)).toEqual([
      'ask',
      'delegate',
      'child-look',
      'child-verdict',
      'answer'
    ])
  })
})
