// Where each subagent's rows live in the transcript.
//
// A subagent's rows are not the conversation's: they sit in a section of their own
// that the reader opens from the agent. A subagent a loaded roster names opens
// under that roster row, keyed by the agent id the roster entry and its rows share.
// One no loaded roster names — its spawn is on an older page, or it was never
// announced — still owns its rows: its section opens where its first row happened,
// inside the section of the agent that spawned it, or in the conversation.

import {
  isSubagentGroupBlock,
  type NativeChatMessage,
  type NativeChatSubagentEntry
} from '../../../../shared/native-chat-types'
import type { NativeChatSubagentRow } from '../../../../shared/native-chat-transcript-projection'
import { compareMessages } from './native-chat-session-assembler'

export type NativeChatSubagentSections = {
  /** Each subagent's own rows, by its id. */
  rows: ReadonlyMap<string, readonly NativeChatSubagentRow[]>
  /** The entry of the first conversation roster naming each subagent. */
  entries: ReadonlyMap<string, NativeChatSubagentEntry>
  /** Roster row id → the subagents whose sections open under it, in roster order. */
  anchoredAt: ReadonlyMap<string, readonly string[]>
  /** Subagents no loaded roster names, by the section they open in (null: the
   *  conversation), in the order of their first rows. */
  unlisted: ReadonlyMap<string | null, readonly string[]>
  /** Row id → the sections enclosing it, outermost first. */
  pathOf: ReadonlyMap<string, readonly string[]>
}

export const NO_NATIVE_CHAT_SUBAGENT_SECTIONS: NativeChatSubagentSections = {
  rows: new Map(),
  entries: new Map(),
  anchoredAt: new Map(),
  unlisted: new Map(),
  pathOf: new Map()
}

export function nativeChatSubagentSections(
  conversation: readonly NativeChatMessage[],
  subagentRows: ReadonlyMap<string, readonly NativeChatSubagentRow[]>
): NativeChatSubagentSections {
  const rows = new Map(Array.from(subagentRows).filter(([, agentRows]) => agentRows.length > 0))
  if (rows.size === 0) {
    return NO_NATIVE_CHAT_SUBAGENT_SECTIONS
  }
  const entries = new Map<string, NativeChatSubagentEntry>()
  const anchoredAt = new Map<string, string[]>()
  for (const message of conversation) {
    for (const block of message.blocks) {
      if (!isSubagentGroupBlock(block)) {
        continue
      }
      for (const agent of block.agents) {
        if (entries.has(agent.id) || !rows.has(agent.id)) {
          continue
        }
        entries.set(agent.id, agent)
        const anchored = anchoredAt.get(message.id)
        if (anchored) {
          anchored.push(agent.id)
        } else {
          anchoredAt.set(message.id, [agent.id])
        }
      }
    }
  }
  const firstRow = (agentId: string): NativeChatMessage => rows.get(agentId)![0]!.message
  // The agent that spawned an unlisted one, when that agent has a section to hold it.
  const spawnerOf = (agentId: string): string | null => {
    const parent = firstRow(agentId).parentAgentId
    return parent !== undefined && parent !== agentId && (entries.has(parent) || rows.has(parent))
      ? parent
      : null
  }
  // A chain of spawners that loops back has no outside to open in.
  const scopeOf = (agentId: string): string | null => {
    const spawner = spawnerOf(agentId)
    const seen = new Set([agentId])
    for (let current = spawner; current !== null && !entries.has(current);) {
      if (seen.has(current)) {
        return null
      }
      seen.add(current)
      current = spawnerOf(current)
    }
    return spawner
  }
  const unlisted = new Map<string | null, string[]>()
  const scopes = new Map<string, string | null>()
  for (const agentId of rows.keys()) {
    if (entries.has(agentId)) {
      continue
    }
    const scope = scopeOf(agentId)
    scopes.set(agentId, scope)
    const inScope = unlisted.get(scope)
    if (inScope) {
      inScope.push(agentId)
    } else {
      unlisted.set(scope, [agentId])
    }
  }
  for (const inScope of unlisted.values()) {
    inScope.sort((a, b) => compareMessages(firstRow(a), firstRow(b)))
  }
  const paths = new Map<string, readonly string[]>()
  const pathTo = (agentId: string): readonly string[] => {
    const known = paths.get(agentId)
    if (known) {
      return known
    }
    const scope = scopes.get(agentId) ?? null
    const path = scope === null ? [agentId] : [...pathTo(scope), agentId]
    paths.set(agentId, path)
    return path
  }
  const pathOf = new Map<string, readonly string[]>()
  for (const [agentId, agentRows] of rows) {
    const path = pathTo(agentId)
    for (const row of agentRows) {
      pathOf.set(row.message.id, path)
    }
  }
  return { rows, entries, anchoredAt, unlisted, pathOf }
}

/** Every row with its turn, the conversation's and each subagent's together, in
 *  transcript order: a subagent's edits are real changes in the turn they happened. */
export function nativeChatRowsInTranscriptOrder(
  messages: readonly NativeChatMessage[],
  turnKeys: readonly (string | undefined)[],
  sections: NativeChatSubagentSections
): { messages: readonly NativeChatMessage[]; turnKeys: readonly (string | undefined)[] } {
  if (sections.rows.size === 0) {
    return { messages, turnKeys }
  }
  const subagentRows = Array.from(sections.rows.values())
    .flat()
    .sort((a, b) => compareMessages(a.message, b.message))
  const merged: NativeChatMessage[] = []
  const mergedTurnKeys: (string | undefined)[] = []
  let next = 0
  for (const [index, message] of messages.entries()) {
    while (
      next < subagentRows.length &&
      compareMessages(subagentRows[next]!.message, message) < 0
    ) {
      merged.push(subagentRows[next]!.message)
      mergedTurnKeys.push(subagentRows[next]!.turnKey)
      next += 1
    }
    merged.push(message)
    mergedTurnKeys.push(turnKeys[index])
  }
  for (const row of subagentRows.slice(next)) {
    merged.push(row.message)
    mergedTurnKeys.push(row.turnKey)
  }
  return { messages: merged, turnKeys: mergedTurnKeys }
}
