import { useCallback, useMemo, useRef, useState } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatSubagentRow } from '../../../../shared/native-chat-transcript-projection'
import { toggleNativeChatExpandedKey } from './native-chat-expanded-keys'
import {
  nativeChatSubagentSections,
  type NativeChatSubagentSections
} from './native-chat-subagent-sections'

const NONE_OPEN: ReadonlySet<string> = new Set()

/** The transcript's subagent sections and which of them the reader has open. */
export function useNativeChatSubagentSections(
  conversation: readonly NativeChatMessage[],
  subagentRows: ReadonlyMap<string, readonly NativeChatSubagentRow[]>
): {
  sections: NativeChatSubagentSections
  expandedSubagentIds: ReadonlySet<string>
  toggleSubagentSection: (agentId: string) => void
  /** Opens every section enclosing a row, so a reveal of that row can land. */
  openSubagentSectionsAround: (messageId: string) => void
} {
  const sections = useMemo(
    () => nativeChatSubagentSections(conversation, subagentRows),
    [conversation, subagentRows]
  )
  const [expandedSubagentIds, setExpandedSubagentIds] = useState(NONE_OPEN)
  // Read at reveal time, so the callback keeps one identity across stream frames.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const toggleSubagentSection = useCallback((agentId: string) => {
    setExpandedSubagentIds((current) => toggleNativeChatExpandedKey(current, agentId))
  }, [])
  const openSubagentSectionsAround = useCallback((messageId: string) => {
    const enclosing = sectionsRef.current.pathOf.get(messageId)
    if (enclosing) {
      setExpandedSubagentIds((current) =>
        enclosing.every((agentId) => current.has(agentId))
          ? current
          : new Set([...current, ...enclosing])
      )
    }
  }, [])
  return { sections, expandedSubagentIds, toggleSubagentSection, openSubagentSectionsAround }
}
