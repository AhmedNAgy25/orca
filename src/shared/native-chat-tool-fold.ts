import {
  isBackgroundTaskBlock,
  isSubagentGroupBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatMessage,
  type NativeChatToolCallBlock,
  type NativeChatToolResultBlock
} from './native-chat-types'
import { isKnownHarnessInjectedUserTurnText } from './harness-injected-user-turns'
import { isNoiseMessage } from './native-chat-noise'

function isToolOnlyMessage(message: NativeChatMessage): boolean {
  return (
    message.blocks.length > 0 &&
    message.blocks.every((block) => isToolCallBlock(block) || isToolResultBlock(block))
  )
}

function isHarnessSidecarToolMessage(message: NativeChatMessage): boolean {
  if (
    message.role !== 'user' ||
    isInterruptionBoundary(message) ||
    !message.blocks.some(isToolResultBlock)
  ) {
    return false
  }
  const textBlocks = message.blocks.filter((block) => block.type === 'text')
  return (
    textBlocks.length > 0 &&
    message.blocks.every(
      (block) =>
        isToolResultBlock(block) ||
        (block.type === 'text' && isKnownHarnessInjectedUserTurnText(block.text))
    )
  )
}

/** Activity rows land mid-turn, between the assistant's tool calls. They are
 *  chrome, not a new turn, so they must not end the run the following tool
 *  messages fold into. */
function isSubagentRosterMessage(message: NativeChatMessage): boolean {
  return message.blocks.some(isSubagentGroupBlock)
}

function isBackgroundTaskMessage(message: NativeChatMessage): boolean {
  return message.blocks.some(isBackgroundTaskBlock)
}

function isInterruptionBoundary(message: NativeChatMessage): boolean {
  return message.blocks.some(
    (block) =>
      block.type === 'text' && block.text.trim().toLowerCase().startsWith('[request interrupted')
  )
}

/** Drop tool results the renderer cannot pair within their folded message. */
function dropUnattributableToolResults(message: NativeChatMessage): NativeChatMessage | null {
  let blocks: NativeChatBlock[] | undefined
  let unansweredCalls = 0
  for (let index = 0; index < message.blocks.length; index++) {
    const block = message.blocks[index]
    if (isToolCallBlock(block)) {
      unansweredCalls += 1
    } else if (isToolResultBlock(block)) {
      if (unansweredCalls === 0) {
        blocks ??= message.blocks.slice(0, index)
        continue
      }
      unansweredCalls -= 1
    }
    blocks?.push(block)
  }
  if (!blocks) {
    return message
  }
  return blocks.length > 0 ? { ...message, blocks } : null
}

/** Fold consecutive tool-only messages into their preceding assistant turn.
 *  Each producer folds into its own: a subagent's calls interleave with its
 *  parent's in one journal, and absorbing them would present one agent's work
 *  as the other's. Rows with no producer linkage all share one run. */
export function foldToolMessages(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  const output: NativeChatMessage[] = []
  const foldTargets = new Map<string | undefined, number>()
  const cloned = new Set<number>()
  const absorb = (index: number, blocks: readonly NativeChatBlock[]): void => {
    if (!cloned.has(index)) {
      output[index] = { ...output[index]!, blocks: [...output[index]!.blocks] }
      cloned.add(index)
    }
    output[index]!.blocks.push(...blocks)
  }
  for (const message of messages) {
    const producer = message.agentId
    const target = foldTargets.get(producer)
    if (isHarnessSidecarToolMessage(message) && target !== undefined) {
      if (output[target]?.role === 'assistant') {
        absorb(target, message.blocks.filter(isToolResultBlock))
        output.push({
          ...message,
          blocks: message.blocks.filter((block) => !isToolResultBlock(block))
        })
        continue
      }
    }
    if (isToolOnlyMessage(message) && target !== undefined) {
      if (output[target]?.role !== 'assistant') {
        output.push(message)
        foldTargets.delete(producer)
        continue
      }
      absorb(target, message.blocks)
      continue
    }
    output.push(message)
    if (message.role === 'assistant') {
      foldTargets.set(producer, output.length - 1)
    } else if (
      !isSubagentRosterMessage(message) &&
      !isBackgroundTaskMessage(message) &&
      (!isNoiseMessage(message) || isInterruptionBoundary(message))
    ) {
      if (message.role === 'user' || isInterruptionBoundary(message)) {
        // A turn boundary ends every run, so a child still working in the next
        // turn does not reach back into the last one.
        foldTargets.clear()
      } else {
        foldTargets.delete(producer)
      }
    }
  }
  const attributedOutput: NativeChatMessage[] = []
  for (const message of output) {
    const attributed = dropUnattributableToolResults(message)
    if (attributed) {
      attributedOutput.push(attributed)
    }
  }
  return attributedOutput
}

export type NativeChatToolPair = {
  call?: NativeChatToolCallBlock
  result?: NativeChatToolResultBlock
}

/** Pair calls and results by FIFO ordinal because transcript blocks carry no tool ids. */
export function pairToolBlocks(
  blocks: readonly NativeChatBlock[],
  limit = Infinity
): NativeChatToolPair[] {
  const pairs: NativeChatToolPair[] = []
  const callSlots: number[] = []
  let resultOrdinal = 0
  for (const block of blocks) {
    if (pairs.length >= limit && resultOrdinal >= callSlots.length) {
      break
    }
    if (block.type === 'tool-call') {
      if (pairs.length < limit) {
        callSlots.push(pairs.length)
        pairs.push({ call: block })
      }
      continue
    }
    if (block.type !== 'tool-result') {
      continue
    }
    const slot = callSlots[resultOrdinal]
    if (slot === undefined) {
      if (pairs.length < limit) {
        pairs.push({ result: block })
      }
    } else {
      resultOrdinal += 1
      pairs[slot]!.result = block
    }
  }
  return pairs
}

export function splitNativeChatBlocks(blocks: readonly NativeChatBlock[]): {
  prose: NativeChatBlock[]
  tools: NativeChatBlock[]
} {
  const prose: NativeChatBlock[] = []
  const tools: NativeChatBlock[] = []
  for (const block of blocks) {
    if (isToolCallBlock(block) || isToolResultBlock(block)) {
      tools.push(block)
    } else {
      prose.push(block)
    }
  }
  return { prose, tools }
}
