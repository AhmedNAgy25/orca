import { useCallback, useMemo, useState } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatSubagentRow } from '../../../../shared/native-chat-transcript-projection'
import { chooseNativeChatExpanded } from './native-chat-expanded-keys'
import {
  nativeChatSubagentRowsInOrder,
  nativeChatSubagentSections,
  type NativeChatSubagentSections
} from './native-chat-subagent-sections'

const NO_CHOICES: ReadonlyMap<string, boolean> = new Map()

/** The transcript's subagent sections, and the ones the reader opened or closed by
 *  hand. Everything else follows its agent: open while it works, closed once it settles. */
export function useNativeChatSubagentSections(
  conversation: readonly NativeChatMessage[],
  subagentRows: ReadonlyMap<string, readonly NativeChatSubagentRow[]>
): {
  sections: NativeChatSubagentSections
  /** Every subagent row in transcript order; kept while only the conversation changes. */
  subagentRowsInOrder: readonly NativeChatSubagentRow[]
  subagentSectionChoices: ReadonlyMap<string, boolean>
  setSubagentSectionOpen: (agentId: string, open: boolean) => void
  /** Opens the sections a row sits in, so a reveal of that row can land. */
  openSubagentSections: (agentIds: readonly string[]) => void
} {
  const sections = useMemo(
    () => nativeChatSubagentSections(conversation, subagentRows),
    [conversation, subagentRows]
  )
  const subagentRowsInOrder = useMemo(
    () => nativeChatSubagentRowsInOrder(subagentRows),
    [subagentRows]
  )
  const [subagentSectionChoices, setChoices] = useState(NO_CHOICES)
  const setSubagentSectionOpen = useCallback((agentId: string, open: boolean) => {
    setChoices((current) => chooseNativeChatExpanded(current, agentId, open))
  }, [])
  const openSubagentSections = useCallback((agentIds: readonly string[]) => {
    setChoices((current) =>
      agentIds.reduce(
        (choices, agentId) => chooseNativeChatExpanded(choices, agentId, true),
        current
      )
    )
  }, [])
  return {
    sections,
    subagentRowsInOrder,
    subagentSectionChoices,
    setSubagentSectionOpen,
    openSubagentSections
  }
}
