import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalCursor,
  AgentJournalRenderItem
} from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentState } from './use-mobile-structured-agent-state'

function cursorAt(sequence: number): AgentJournalCursor {
  return { epoch: 'epoch-1', sequence }
}

function said(sequence: number, agentId?: string): AgentJournalRenderItem {
  return {
    itemId: `item-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: `${sequence}` }] },
    ...(agentId === undefined ? {} : { agentId })
  }
}

function range(from: number, to: number, agentId?: string): AgentJournalRenderItem[] {
  return Array.from({ length: to - from }, (_, index) => said(from + index, agentId))
}

function page(items: AgentJournalRenderItem[], hasOlder: boolean): AgentSessionHistoryPage {
  const oldest = items[0]
  const newest = items.at(-1)
  return {
    sessionId: 'session-1',
    epoch: 'epoch-1',
    fence: 1,
    direction: 'before',
    items,
    removedItemIds: [],
    submissions: [],
    window: {
      oldest: oldest ? cursorAt(oldest.sequence) : null,
      newest: newest ? cursorAt(newest.sequence) : null,
      nextCursor: cursorAt(oldest?.sequence ?? 0)
    },
    liveCursor: cursorAt(1_000),
    hasOlder,
    hasNewer: false
  }
}

describe('useMobileStructuredAgentState older history', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  /** Mounts the hook on a session whose newest row is the session's own, at 1000,
   *  with the host serving `older` by the cursor each read asks before. */
  async function mountWithOlderPages(older: Record<number, AgentSessionHistoryPage>) {
    let onFrame: ((value: unknown) => void) | null = null
    const historyCursors: number[] = []
    const client: Pick<RpcClient, 'sendRequest' | 'subscribe'> = {
      sendRequest: async (method, params) => {
        if (method !== 'agentSession.history') {
          return { ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } }
        }
        const { cursor } = params as { cursor: AgentJournalCursor }
        historyCursors.push(cursor.sequence)
        return {
          ok: true,
          result: { ok: true, page: older[cursor.sequence] },
          _meta: { runtimeId: 'runtime-1' }
        }
      },
      subscribe: (_method, _params, frame) => {
        onFrame = frame
        return () => {}
      }
    }
    const hook: { current: ReturnType<typeof useMobileStructuredAgentState> | null } = {
      current: null
    }
    function Harness(): null {
      hook.current = useMobileStructuredAgentState({
        client: client as RpcClient,
        sessionId: 'session-1',
        sessionKey: 'session-1',
        enabled: true,
        connected: true
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(onFrame).not.toBeNull())
    act(() => {
      onFrame!({
        type: 'snapshot',
        sessionId: 'session-1',
        fence: 1,
        page: page([said(1_000)], true)
      })
    })
    await vi.waitFor(() => expect(hook.current!.state.hasOlder).toBe(true))
    return { hook, historyCursors }
  }

  it("reads past pages of a subagent's rows to the session's own older rows", async () => {
    const { hook, historyCursors } = await mountWithOlderPages({
      1000: page(range(800, 1_000, 'task-1'), true),
      800: page(range(600, 800, 'task-1'), true),
      600: page(range(1, 101), false)
    })

    act(() => hook.current!.loadEarlier())

    await vi.waitFor(() => expect(hook.current!.state.items[0]?.sequence).toBe(1))
    expect(historyCursors).toEqual([1_000, 800, 600])
    expect(hook.current!.state.hasOlder).toBe(false)
  })

  it("stops at the first page that holds a row of the session's own", async () => {
    const { hook, historyCursors } = await mountWithOlderPages({
      1000: page([...range(800, 999, 'task-1'), said(999)], true),
      800: page(range(600, 800), true)
    })

    act(() => hook.current!.loadEarlier())

    await vi.waitFor(() => expect(hook.current!.state.items[0]?.sequence).toBe(800))
    expect(historyCursors).toEqual([1_000])
    expect(hook.current!.state.hasOlder).toBe(true)
  })
})
