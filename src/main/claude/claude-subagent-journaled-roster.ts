// What earlier runs of this session left of the Claude subagent roster, re-derived
// from the rows they journaled.
//
// The roster lives in one provider process, but everything it writes outlives that
// process: a group row keeps a restart-stable identity, and every agent row names its
// canonical id beside the call its frames arrived under. A run that started from
// nothing re-rostered a resumed child in a second row, restarted its attempts, lost
// the alias its resumed frames still carry, and rewrote the one group row no turn
// owns from empty. So a run reads what earlier runs left instead: derived, never
// stored, so it cannot disagree with the rows it came from.

import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import type { AgentJournalProducerLinkage } from '../../shared/agent-session-journal-types'
import { isSubagentGroupBlock, type NativeChatSubagentEntry } from '../../shared/native-chat-types'
import type { StructuredAgentSessionLinkageJournal } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { isBoundedClaudeTaskId } from './claude-background-task-tracker'
import { claudeSubagentGroupIdentity } from './claude-subagent-group-row'

/** What the roster asks of earlier runs. */
export type ClaudeJournaledRosterSource = {
  /** The task id an earlier run resolved this spawn call to. */
  canonical: (toolUseId: string) => string | null
  /** The group row an earlier run last listed this child in. */
  groupOf: (entryId: string) => string | null
  /** An earlier run's entries for one group, handed over once: after that the
   *  roster's own copy is the newer one. */
  claimGroup: (groupId: string) => readonly NativeChatSubagentEntry[] | null
  /** The latest run of this child any row records; 1 when none says more. */
  attempt: (agentId: string) => number
}

type JournaledRosterReading = {
  canonicalByToolUse: Map<string, string>
  attemptByAgent: Map<string, number>
  entriesByGroup: Map<string, readonly NativeChatSubagentEntry[]>
  groupByEntry: Map<string, string>
}

/**
 * Read once per bound journal epoch. Before the journal is bound nothing is read and
 * nothing is kept, so the first read after bind still sees every row.
 */
export class ClaudeJournaledRoster implements ClaudeJournaledRosterSource {
  private journal: StructuredAgentSessionLinkageJournal | null = null
  private epoch: string | null = null
  private reading: JournaledRosterReading | null = null

  constructor(private readonly bound: () => StructuredAgentSessionLinkageJournal | null) {}

  canonical = (toolUseId: string): string | null =>
    this.current()?.canonicalByToolUse.get(toolUseId) ?? null

  groupOf = (entryId: string): string | null => this.current()?.groupByEntry.get(entryId) ?? null

  claimGroup = (groupId: string): readonly NativeChatSubagentEntry[] | null => {
    const reading = this.current()
    const entries = reading?.entriesByGroup.get(groupId) ?? null
    reading?.entriesByGroup.delete(groupId)
    return entries
  }

  attempt = (agentId: string): number => this.current()?.attemptByAgent.get(agentId) ?? 1

  private current(): JournaledRosterReading | null {
    const journal = this.bound()
    if (!journal) {
      return null
    }
    if (!this.reading || journal !== this.journal || journal.epoch !== this.epoch) {
      this.journal = journal
      this.epoch = journal.epoch
      this.reading = readJournaledRoster(journal)
    }
    return this.reading
  }
}

function readJournaledRoster(
  journal: StructuredAgentSessionLinkageJournal
): JournaledRosterReading {
  const reading: JournaledRosterReading = {
    canonicalByToolUse: new Map(),
    attemptByAgent: new Map(),
    entriesByGroup: new Map(),
    groupByEntry: new Map()
  }
  // A child listed by two group rows is the newer row's: that is where it last ran.
  const listedAt = new Map<string, number>()
  journal.visitItemsWithLinkage((itemId, sequence, body, linkage) => {
    readAgentRow(reading, linkage)
    const group = body.kind === 'message' ? body.blocks.find(isSubagentGroupBlock) : undefined
    if (!group || itemId !== agentJournalItemKey(claudeSubagentGroupIdentity(group.groupId))) {
      return
    }
    reading.entriesByGroup.set(group.groupId, group.agents)
    for (const entry of group.agents) {
      if ((listedAt.get(entry.id) ?? -1) < sequence) {
        listedAt.set(entry.id, sequence)
        reading.groupByEntry.set(entry.id, group.groupId)
      }
    }
  })
  return reading
}

function readAgentRow(
  reading: JournaledRosterReading,
  { agentId, providerParentRef, producerKind, attempt }: AgentJournalProducerLinkage
): void {
  if (producerKind !== 'agent' || agentId === undefined) {
    return
  }
  if (attempt !== undefined && attempt > (reading.attemptByAgent.get(agentId) ?? 1)) {
    reading.attemptByAgent.set(agentId, attempt)
  }
  // A row stamped with its own reference was never resolved, so it names no alias.
  if (
    providerParentRef !== undefined &&
    agentId !== providerParentRef &&
    isBoundedClaudeTaskId(agentId) &&
    isBoundedClaudeTaskId(providerParentRef)
  ) {
    reading.canonicalByToolUse.set(providerParentRef, agentId)
  }
}
