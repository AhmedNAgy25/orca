// One transcript slot per row the reader can actually see.
//
// Without windowing "a message that draws nothing" costs nothing: React renders
// null and the flex column lays out what's left. With windowing every entry is a
// counted index that reserves estimated height, so a message the list counts and
// the row declines to draw becomes a gap in the transcript. This module is the
// single place that answers "does this message take a slot?", and it answers it
// with the same derivation the row itself renders from.

import {
  isBackgroundTaskBlock,
  isSubagentGroupBlock,
  isToolCallBlock,
  type NativeChatMessage,
  type NativeChatSubagentEntry
} from '../../../../shared/native-chat-types'
import type { NativeChatTurnStatus } from '../../../../shared/native-chat-turn-status'
import { normalizeSubagentState } from '../../../../shared/native-chat-subagent-summary'
import {
  nativeChatTurnFold,
  type NativeChatTurnFoldRow
} from '../../../../shared/native-chat-turn-fold'
import {
  deriveNativeChatRowContent,
  nativeChatRowRendersContent
} from '../../../../shared/native-chat-row-content'
import {
  estimateNativeChatRowHeight,
  nativeChatRowContentMetrics,
  NATIVE_CHAT_SUBAGENT_SECTION_HEAD_PX
} from './native-chat-row-height-estimate'
import type { NativeChatResolvedPrompt } from './native-chat-resolution-receipt'
import type { NativeChatTurnDiff } from './native-chat-turn-diffs'
import { compareMessages } from './native-chat-session-assembler'
import {
  NO_NATIVE_CHAT_SUBAGENT_SECTIONS,
  type NativeChatSubagentSections
} from './native-chat-subagent-sections'

export type NativeChatTranscriptSlot = NativeChatMessageSlot | NativeChatSubagentSectionSlot

/** The head of one subagent's section: it names whose rows follow it. */
export type NativeChatSubagentSectionSlot = {
  kind: 'subagent'
  agentId: string
  /** The conversation turn this head sits in, so the outline rail can place it. */
  turnKey: string | undefined
  /** The roster's entry for the agent; absent when no loaded roster names it. */
  entry: NativeChatSubagentEntry | undefined
  expanded: boolean
  /** Sections this head sits inside; 0 is the conversation. */
  depth: number
  estimatedHeight: number
}

export type NativeChatMessageSlot = {
  kind: 'message'
  message: NativeChatMessage
  turnKey: string | undefined
  /** The row's own turn is the one still running, so its tools stay live. */
  activeTurnIsWorking: boolean
  /** Nothing the agent said or did comes after this row, so its tool run is
   *  the one still live while the turn works. A later run or answer settles it;
   *  a reasoning aside does not, the agent is still inside the same batch. */
  trailingRun: boolean
  /** Resolved approval/question stands in for the message it answered. */
  receipt: NativeChatResolvedPrompt | undefined
  /** Turn timing shown under this row, already filtered to "should render". */
  status: NativeChatTurnStatus | undefined
  /** This row is behind its turn's folded status row: it draws no prose and no
   *  tool activity, only work that outlives the turn. */
  folded: boolean
  /** Whether this row's turn hides anything, so its status row offers a caret. */
  turnFolds: boolean
  turnDiff: NativeChatTurnDiff | undefined
  /** On a roster row: the subagents whose sections open under it, and whether
   *  the reader opened each. */
  subagentSections: ReadonlyMap<string, boolean> | undefined
  /** Subagent sections this row sits inside; 0 is the conversation. */
  depth: number
  /** Height to reserve before the row has ever been measured. */
  estimatedHeight: number
}

export type NativeChatTranscriptSlotsInput = {
  messages: readonly NativeChatMessage[]
  turnKeys: readonly (string | undefined)[]
  latestUserIndex: number
  currentTurnKey: string | undefined
  receipts: ReadonlyMap<string, NativeChatResolvedPrompt>
  turnStatuses: {
    active: NativeChatTurnStatus | null
    completedByTurn: Readonly<Record<string, NativeChatTurnStatus>>
  }
  turnDiffs: ReadonlyMap<string, NativeChatTurnDiff>
  showTurnStatus: boolean
  /** Turns the reader opened. Everything else with a duration stays folded. */
  expandedTurnKeys: ReadonlySet<string>
  isWorking: boolean
  /** Session-level lifecycle, which outlives a transcript that never said "done". */
  lifecycleWorking: boolean
  subagentSections?: NativeChatSubagentSections
  /** Sections the reader opened (true) or closed (false) by hand. */
  subagentSectionChoices?: ReadonlyMap<string, boolean>
}

/** Whether a row moves its agent past the run above it. An approval's receipt
 *  decides a call of that run, which then runs, so it does not. */
function speaksOrActs(
  message: NativeChatMessage,
  rendersProse: boolean,
  receipts: ReadonlyMap<string, NativeChatResolvedPrompt>
): boolean {
  return (
    message.role !== 'user' &&
    message.role !== 'reasoning' &&
    receipts.get(message.id)?.kind !== 'approval' &&
    (rendersProse || message.blocks.some(isToolCallBlock))
  )
}

function rendersProse(message: NativeChatMessage): boolean {
  const content = deriveNativeChatRowContent(message.blocks)
  return content.markdown.length > 0 || content.hasImages
}

export function buildNativeChatTranscriptSlots(
  input: NativeChatTranscriptSlotsInput
): NativeChatTranscriptSlot[] {
  const {
    messages,
    turnKeys,
    latestUserIndex,
    currentTurnKey,
    receipts,
    turnStatuses,
    turnDiffs,
    showTurnStatus,
    expandedTurnKeys,
    isWorking,
    lifecycleWorking,
    subagentSections: sections = NO_NATIVE_CHAT_SUBAGENT_SECTIONS,
    subagentSectionChoices: sectionChoices = NO_SECTION_CHOICES
  } = input
  // One pass to decide what each row draws, then the fold over those readings —
  // so "is this the answer" and "does this row render prose" cannot disagree.
  const foldRows: NativeChatTurnFoldRow[] = messages.map((message, index) => {
    return {
      turnKey: turnKeys[index],
      role: message.role,
      rendersProse: rendersProse(message),
      // The raw blocks, not the renderable ones: a childless roster draws no row
      // and its plain-text twin is then the only record the spawn happened.
      outlivesTurn: message.blocks.some(
        (block) => isSubagentGroupBlock(block) || isBackgroundTaskBlock(block)
      )
    }
  })
  // Liveness is the turn's, not any one call's: the run at the frontier stays
  // live between its calls, and a run the agent has moved past is settled even
  // while its last call is still reporting.
  const trailingRunIndex = foldRows.findLastIndex((row, index) =>
    speaksOrActs(messages[index]!, row.rendersProse, receipts)
  )
  const settledTurnKeys = new Set(
    showTurnStatus
      ? Object.entries(turnStatuses.completedByTurn)
          .filter(([, status]) => status.workedSeconds != null)
          .map(([turnKey]) => turnKey)
      : []
  )
  const { foldedRows, foldableTurnKeys } = nativeChatTurnFold({
    rows: foldRows,
    settledTurnKeys,
    expandedTurnKeys
  })
  const slots: NativeChatTranscriptSlot[] = []
  const sectionSlots = subagentSectionSlots({ sections, sectionChoices, receipts, slots })
  const pending = [...(sections.openAt.get(null) ?? [])]
  for (const [index, message] of messages.entries()) {
    sectionSlots.openBefore(pending, message, 0)
    const turnKey = turnKeys[index]
    const receipt = receipts.get(message.id)
    const candidateStatus =
      index === latestUserIndex
        ? turnStatuses.active
        : message.role === 'user' && turnKey
          ? turnStatuses.completedByTurn[turnKey]
          : undefined
    // The live turn's bar carries its running clock; it settles in place.
    const status = showTurnStatus ? (candidateStatus ?? undefined) : undefined
    const turnDiff = turnKey && turnKeys[index + 1] !== turnKey ? turnDiffs.get(turnKey) : undefined
    const folded = foldedRows.has(index)
    // Skipping a folded row entirely is what keeps windowing honest: a counted
    // index the row declines to draw reserves estimated height for nothing and
    // opens a gap in the transcript.
    const drawsRow =
      receipt !== undefined || (!folded && nativeChatRowRendersContent(message.blocks))
    if (drawsRow || status !== undefined || turnDiff !== undefined) {
      slots.push({
        kind: 'message',
        message,
        turnKey,
        activeTurnIsWorking:
          (currentTurnKey ? turnKey === currentTurnKey : turnKey === undefined) &&
          (isWorking || lifecycleWorking),
        trailingRun: index === trailingRunIndex,
        receipt,
        status: status ?? undefined,
        folded,
        turnFolds: turnKey !== undefined && foldableTurnKeys.has(turnKey),
        turnDiff,
        subagentSections: sectionSlots.sectionsAt(message.id),
        depth: 0,
        estimatedHeight: estimateNativeChatRowHeight(nativeChatRowContentMetrics(message), {
          hasReceipt: receipt !== undefined,
          hasStatus: status !== undefined,
          hasTurnDiff: turnDiff !== undefined,
          folded
        })
      })
    }
    sectionSlots.openAnchoredAt(message.id, 0, turnKey)
  }
  sectionSlots.openBefore(pending, undefined, 0)
  return slots
}

const NO_SECTION_CHOICES: ReadonlyMap<string, boolean> = new Map()

/** Emits subagent sections into `slots`: one the session spawned after the roster
 *  row that names it, once open; any other's head where its first row happened,
 *  and its rows once open. A section is open while its agent works and closed once
 *  it settles, like the turn's own live run; the reader's choice outranks both. */
function subagentSectionSlots({
  sections,
  sectionChoices,
  receipts,
  slots
}: {
  sections: NativeChatSubagentSections
  sectionChoices: ReadonlyMap<string, boolean>
  receipts: ReadonlyMap<string, NativeChatResolvedPrompt>
  slots: NativeChatTranscriptSlot[]
}) {
  const isLive = (agentId: string): boolean => {
    const entry = sections.entries.get(agentId)
    return entry !== undefined && normalizeSubagentState(entry.state) === 'working'
  }
  const isOpen = (agentId: string): boolean => sectionChoices.get(agentId) ?? isLive(agentId)
  const pushHead = (agentId: string, depth: number, turnKey: string | undefined): void => {
    slots.push({
      kind: 'subagent',
      agentId,
      turnKey,
      entry: sections.entries.get(agentId),
      expanded: isOpen(agentId),
      depth,
      estimatedHeight: NATIVE_CHAT_SUBAGENT_SECTION_HEAD_PX
    })
  }
  const pushRows = (agentId: string, depth: number): void => {
    const rows = sections.rows.get(agentId) ?? []
    // The agent's own frontier: its trailing run is live while the agent works.
    const working = isLive(agentId)
    const trailing = rows.findLastIndex((row) =>
      speaksOrActs(row.message, rendersProse(row.message), receipts)
    )
    const pending = [...(sections.openAt.get(agentId) ?? [])]
    for (const [index, { message, turnKey }] of rows.entries()) {
      openBefore(pending, message, depth)
      const receipt = receipts.get(message.id)
      if (receipt === undefined && !nativeChatRowRendersContent(message.blocks)) {
        continue
      }
      slots.push({
        kind: 'message',
        message,
        turnKey,
        activeTurnIsWorking: working,
        trailingRun: index === trailing,
        receipt,
        status: undefined,
        folded: false,
        turnFolds: false,
        turnDiff: undefined,
        subagentSections: undefined,
        depth,
        estimatedHeight: estimateNativeChatRowHeight(nativeChatRowContentMetrics(message), {
          hasReceipt: receipt !== undefined,
          hasStatus: false,
          hasTurnDiff: false
        })
      })
    }
    openBefore(pending, undefined, depth)
  }
  /** Heads, ahead of `message`, each pending section whose first row came before
   *  it, with its rows when open; `undefined` flushes the rest. */
  function openBefore(pending: string[], message: NativeChatMessage | undefined, depth: number) {
    while (pending.length > 0) {
      const agentId = pending[0]!
      const first = sections.rows.get(agentId)?.[0]
      if (
        message !== undefined &&
        first !== undefined &&
        compareMessages(first.message, message) >= 0
      ) {
        return
      }
      pending.shift()
      pushHead(agentId, depth, first?.turnKey)
      if (isOpen(agentId)) {
        pushRows(agentId, depth + 1)
      }
    }
  }
  return {
    openBefore,
    /** The open sections of the subagents a roster row names, in roster order. */
    openAnchoredAt(messageId: string, depth: number, turnKey: string | undefined): void {
      for (const agentId of sections.anchoredAt.get(messageId) ?? []) {
        if (isOpen(agentId)) {
          pushHead(agentId, depth, turnKey)
          pushRows(agentId, depth + 1)
        }
      }
    },
    sectionsAt(messageId: string): ReadonlyMap<string, boolean> | undefined {
      const anchored = sections.anchoredAt.get(messageId)
      return anchored === undefined
        ? undefined
        : new Map(anchored.map((agentId) => [agentId, isOpen(agentId)]))
    }
  }
}

/** Stable key for a slot: its message id, or the agent whose section it heads. */
export function nativeChatSlotKey(slot: NativeChatTranscriptSlot): string {
  return slot.kind === 'message' ? slot.message.id : `subagent-section:${slot.agentId}`
}

/** Slot index of a message id, or -1. Reveal targets arrive as ids because the
 *  row that owns them may not be mounted to be pointed at. */
export function nativeChatSlotIndexOf(
  slots: readonly NativeChatTranscriptSlot[],
  messageId: string | undefined
): number {
  if (messageId === undefined) {
    return -1
  }
  return slots.findIndex((slot) => slot.kind === 'message' && slot.message.id === messageId)
}
