// Which subagent sections a running scope holds open by default.
//
// A section opens only while the roster row naming its agent is the live frontier of a
// running scope: nothing its spawner produced since, user rows aside. It stops as soon as
// newer output supersedes that row, even while the agent still works; its roster keeps
// showing that live state. The session is the outer scope; a subagent still working is a
// scope of its own for the sections it spawned, and a settled one closes its scope. Derived
// every render, with no latch; the reader's own choice outranks it.

import { compareAgentJournalPositions } from '../../../../shared/agent-session-journal-position'
import { normalizeSubagentState } from '../../../../shared/native-chat-subagent-summary'
import { nativeChatRowRendersContent } from '../../../../shared/native-chat-row-content'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatSubagentSections } from './native-chat-subagent-sections'

const NONE: ReadonlySet<string> = new Set()

/** A row the reader sees the scope's agent produce. */
function isOutput(message: NativeChatMessage): boolean {
  return message.role !== 'user' && nativeChatRowRendersContent(message.blocks)
}

/** `scopeActive`: the session is running. */
export function nativeChatSubagentLiveSections(
  conversation: readonly NativeChatMessage[],
  sections: NativeChatSubagentSections,
  scopeActive: boolean
): ReadonlySet<string> {
  if (!scopeActive || sections.rows.size === 0) {
    return NONE
  }
  const live = new Set<string>()
  const visit = (scopeRows: readonly NativeChatMessage[], members: readonly string[]): void => {
    const frontier = scopeRows.findLast(isOutput)
    for (const agentId of members) {
      const roster = sections.rosters.get(agentId)
      if (
        roster !== undefined &&
        (frontier === undefined ||
          frontier.id === roster.rowId ||
          (frontier.journalPosition !== undefined &&
            roster.position !== undefined &&
            compareAgentJournalPositions(frontier.journalPosition, roster.position) < 0))
      ) {
        live.add(agentId)
      }
      const entry = sections.entries.get(agentId)
      if (entry !== undefined && normalizeSubagentState(entry.state) === 'working') {
        visit(
          (sections.rows.get(agentId) ?? []).map((row) => row.message),
          sections.openAt.get(agentId) ?? []
        )
      }
    }
  }
  visit(conversation, [
    ...Array.from(sections.anchoredAt.values()).flat(),
    ...(sections.openAt.get(null) ?? [])
  ])
  return live
}
