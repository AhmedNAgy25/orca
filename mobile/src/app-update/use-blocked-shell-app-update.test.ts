import { createElement, useSyncExternalStore } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockRemedy } from '../components/ProtocolBlockScreen'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { useBlockedShellAppUpdate } from './use-blocked-shell-app-update'

const checker = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const snapshotOf = (available: KnownAppUpdate | null, dismissedVersion: string | null) => ({
    lastCheckedAt: null,
    available,
    dismissedVersion,
    checking: false
  })
  let snapshot = snapshotOf(null, null)
  return {
    checkNow: vi.fn(() => Promise.resolve('failed')),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    publish(next: KnownAppUpdate | null, dismissed: string | null = null) {
      snapshot = snapshotOf(next, dismissed)
      listeners.forEach((listener) => listener())
    }
  }
})

vi.mock('./app-update-runtime', () => ({
  appUpdateChecker: { checkNow: checker.checkNow },
  useAppUpdateState: () => useSyncExternalStore(checker.subscribe, checker.getSnapshot)
}))

const RELEASE = { version: '0.0.52', url: 'https://example.test/0.0.52' }
let renderer: ReactTestRenderer | null = null
let offered: KnownAppUpdate | null = null

function Probe({ remedy }: { remedy: BlockRemedy | null }) {
  offered = useBlockedShellAppUpdate(remedy)
  return null
}

function mount(remedy: BlockRemedy | null): void {
  act(() => {
    renderer = create(createElement(Probe, { remedy }))
  })
}

describe('useBlockedShellAppUpdate', () => {
  beforeEach(() => {
    checker.checkNow.mockClear()
    checker.publish(null)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('checks once on mount and not again when the result is published', () => {
    mount('update-mobile')
    act(() => checker.publish(RELEASE))
    expect(offered).toEqual(RELEASE)
    expect(checker.checkNow).toHaveBeenCalledTimes(1)
  })

  it('offers a release the user dismissed on home, because it is the way past the wall', () => {
    checker.publish(RELEASE, RELEASE.version)
    mount('update-mobile')
    expect(offered).toEqual(RELEASE)
  })

  it.each(['update-desktop', 'refresh-bundle', null] as const)('never checks for %s', (remedy) => {
    mount(remedy)
    act(() => renderer?.update(createElement(Probe, { remedy })))
    expect(checker.checkNow).not.toHaveBeenCalled()
  })
})
