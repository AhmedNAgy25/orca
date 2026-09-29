// Where each subagent's rows live in the transcript.
//
// A subagent's rows are not the conversation's: they sit in a section of their own,
// keyed by the agent id its roster entry and its rows share. One the session spawned
// opens under the roster row that names it. One another subagent spawned opens
// inside that subagent's section, where its first row happened. One no loaded roster
// names — its spawn is on an older page, or it was never announced — opens where its
// first row happened, in the conversation.

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
  /** Every other subagent, by the section it opens in (null: the conversation), in
   *  the order of their first rows. */
  openAt: ReadonlyMap<string | null, readonly string[]>
  /** Row id → the sections enclosing it, outermost first. */
  pathOf: ReadonlyMap<string, readonly string[]>
}

export const NO_NATIVE_CHAT_SUBAGENT_SECTIONS: NativeChatSubagentSections = {
  rows: new Map(),
  entries: new Map(),
  anchoredAt: new Map(),
  openAt: new Map(),
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
  const rosterOf = new Map<string, string>()
  for (const message of conversation) {
    for (const block of message.blocks) {
      if (!isSubagentGroupBlock(block)) {
        continue
      }
      for (const agent of block.agents) {
        if (!entries.has(agent.id) && rows.has(agent.id)) {
          entries.set(agent.id, agent)
          rosterOf.set(agent.id, message.id)
        }
      }
    }
  }
  const firstRow = (agentId: string): NativeChatMessage => rows.get(agentId)![0]!.message
  // The subagent that spawned this one, when it has a section to hold it.
  const spawnerOf = (agentId: string): string | null => {
    const parent = firstRow(agentId).parentAgentId
    return parent !== undefined && parent !== agentId && rows.has(parent) ? parent : null
  }
  // A chain of spawners that loops back has no outside to open in.
  const scopeOf = (agentId: string): string | null => {
    const spawner = spawnerOf(agentId)
    const seen = new Set([agentId])
    for (let current = spawner; current !== null; current = spawnerOf(current)) {
      if (seen.has(current)) {
        return null
      }
      seen.add(current)
    }
    return spawner
  }
  const scopes = new Map<string, string | null>()
  const openAt = new Map<string | null, string[]>()
  for (const agentId of rows.keys()) {
    const scope = scopeOf(agentId)
    scopes.set(agentId, scope)
    if (scope !== null || !entries.has(agentId)) {
      const inScope = openAt.get(scope)
      if (inScope) {
        inScope.push(agentId)
      } else {
        openAt.set(scope, [agentId])
      }
    }
  }
  for (const inScope of openAt.values()) {
    inScope.sort((a, b) => compareMessages(firstRow(a), firstRow(b)))
  }
  const anchoredAt = new Map<string, string[]>()
  for (const [agentId, rosterId] of rosterOf) {
    if (scopes.get(agentId) === null) {
      const anchored = anchoredAt.get(rosterId)
      if (anchored) {
        anchored.push(agentId)
      } else {
        anchoredAt.set(rosterId, [agentId])
      }
    }
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
  return { rows, entries, anchoredAt, openAt, pathOf }
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
