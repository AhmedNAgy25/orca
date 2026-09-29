// Which Claude ids name the same subagent, and which name no subagent at all.
//
// Claude re-announces a resumed task under a NEW `tool_use_id` while `task_id`
// stays put, so tool ids are aliases of a canonical task id — a store keyed on
// the tool id would show the child twice after every resume.
//
// The exclusions matter just as much: `task_updated` carries no `task_type` and
// child traffic carries no task metadata at all, so the one announcement that
// said "this is a backgrounded shell, not an agent" has to be remembered or a
// later frame re-admits it.
//
// An alias outlives the process that learned it. A child resumed after its
// session's provider restarted still parents its frames to the ORIGINAL spawn
// call, while the announcement this process sees names only the resuming call —
// so the spawn call's alias is recalled from the rows the earlier run journaled.

import type { StructuredAgentSessionLinkageJournal } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { isBoundedClaudeTaskId } from './claude-background-task-tracker'

/** Both maps are event-accumulated and nothing prunes them, so both are bounded. */
const MAX_TOOL_USE_ALIASES = 512
const MAX_EXCLUDED_IDS = 512

export class ClaudeSubagentIds {
  private readonly canonicalByToolUse = new Map<string, string>()
  private readonly excluded = new Set<string>()

  /** `journaled` answers for aliases an earlier run of this session learned. */
  constructor(private readonly journaled?: (toolUseId: string) => string | null) {}

  /** The task id a tool id stands for, or the id itself when nothing aliases it. */
  canonical(id: string): string {
    return this.canonicalByToolUse.get(id) ?? this.journaled?.(id) ?? id
  }

  /** Whether an announcement has named this tool id, in this run or an earlier
   *  one. Distinct from `canonical` returning the id unchanged, which is also
   *  what an unknown id gets: only this says the identity behind the id is
   *  settled rather than provisional. */
  isAnnounced(toolUseId: string): boolean {
    return this.canonicalByToolUse.has(toolUseId) || (this.journaled?.(toolUseId) ?? null) !== null
  }

  alias(toolUseId: string, taskId: string): void {
    if (!isBoundedClaudeTaskId(toolUseId) || !isBoundedClaudeTaskId(taskId)) {
      return
    }
    this.canonicalByToolUse.set(toolUseId, taskId)
    while (this.canonicalByToolUse.size > MAX_TOOL_USE_ALIASES) {
      const oldest = this.canonicalByToolUse.keys().next()
      if (oldest.done || oldest.value === toolUseId) {
        break
      }
      this.canonicalByToolUse.delete(oldest.value)
    }
  }

  exclude(id: string): void {
    if (!isBoundedClaudeTaskId(id)) {
      return
    }
    this.excluded.add(id)
    while (this.excluded.size > MAX_EXCLUDED_IDS) {
      const oldest = this.excluded.values().next()
      if (oldest.done || oldest.value === id) {
        break
      }
      this.excluded.delete(oldest.value)
    }
  }

  isExcluded(...ids: (string | null)[]): boolean {
    return ids.some((id) => id !== null && this.excluded.has(id))
  }

  clear(): void {
    this.canonicalByToolUse.clear()
    this.excluded.clear()
  }
}

/**
 * The aliases an earlier run of this session learned, re-derived from the rows it
 * journaled: each agent row names its canonical id beside the spawn call its
 * frames arrived under. Derived rather than stored, so it cannot disagree with
 * the rows it came from.
 *
 * Read per bound journal epoch. Before the journal is bound nothing is recalled
 * and nothing is cached, so the first read after bind still sees every row.
 */
export class ClaudeJournaledSubagentIds {
  private journal: StructuredAgentSessionLinkageJournal | null = null
  private epoch: string | null = null
  private canonicalByToolUse = new Map<string, string>()

  constructor(private readonly bound: () => StructuredAgentSessionLinkageJournal | null) {}

  canonical = (toolUseId: string): string | null => {
    const journal = this.bound()
    if (!journal) {
      return null
    }
    if (journal !== this.journal || journal.epoch !== this.epoch) {
      this.journal = journal
      this.epoch = journal.epoch
      this.canonicalByToolUse = journaledAliases(journal)
    }
    return this.canonicalByToolUse.get(toolUseId) ?? null
  }
}

function journaledAliases(journal: StructuredAgentSessionLinkageJournal): Map<string, string> {
  const aliases = new Map<string, string>()
  journal.visitItemLinkage(({ agentId, providerParentRef, producerKind }) => {
    // A row stamped with its own reference was never resolved, so it names no alias.
    if (
      producerKind === 'agent' &&
      agentId !== undefined &&
      providerParentRef !== undefined &&
      agentId !== providerParentRef &&
      isBoundedClaudeTaskId(agentId) &&
      isBoundedClaudeTaskId(providerParentRef)
    ) {
      aliases.set(providerParentRef, agentId)
    }
  })
  return aliases
}
