import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, useSyncExternalStore } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blockRemedy,
  type BlockRemedy,
  type BlockedVerdict
} from '../components/ProtocolBlockScreen'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { APP_UPDATE_RETRY_INTERVAL_MS } from './app-update-checker'
import { useBlockedShellAppUpdate } from './use-blocked-shell-app-update'
import { useBlockedShellAppUpdate as usePageBlockedShellAppUpdate } from './use-blocked-shell-app-update.web'

const checker = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  type Snapshot = {
    lastCheckedAt: number | null
    available: KnownAppUpdate | null
    dismissedVersion: string | null
    checking: boolean
  }
  let snapshot: Snapshot = {
    lastCheckedAt: null,
    available: null,
    dismissedVersion: null,
    checking: false
  }
  return {
    checkNow: vi.fn(() => Promise.resolve('failed')),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    publish(next: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...next }
      listeners.forEach((listener) => listener())
    }
  }
})

// The verdict-to-remedy mapping is the wall's; its module needs these to load.
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }))

vi.mock('./app-update-runtime', () => ({
  appUpdateChecker: { checkNow: checker.checkNow, getSnapshot: checker.getSnapshot },
  useAppUpdateState: () => useSyncExternalStore(checker.subscribe, checker.getSnapshot)
}))

const NOW = Date.UTC(2026, 8, 29, 12)
const RELEASE = { version: '0.0.52', url: 'https://example.test/0.0.52' }
const UPDATE_MOBILE_VERDICTS: BlockedVerdict[] = [
  { kind: 'blocked', reason: 'mobile-too-old', desktopVersion: 5, requiredMobileVersion: 9 },
  { kind: 'blocked', reason: 'bundle-shell-too-old', schemaVersion: 2 }
]
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

function unmount(): void {
  act(() => renderer?.unmount())
  renderer = null
}

describe('useBlockedShellAppUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    checker.checkNow.mockClear()
    checker.publish({ lastCheckedAt: null, available: null, dismissedVersion: null })
  })

  afterEach(() => {
    unmount()
    vi.useRealTimers()
  })

  it.each(UPDATE_MOBILE_VERDICTS)(
    'checks once on the $reason wall and not again when the result is published',
    (verdict) => {
      mount(blockRemedy(verdict))
      act(() => checker.publish({ lastCheckedAt: NOW, available: RELEASE }))
      expect(offered).toEqual(RELEASE)
      expect(checker.checkNow).toHaveBeenCalledTimes(1)
    }
  )

  it('offers a known release without checking, even one dismissed on home', () => {
    checker.publish({ available: RELEASE, dismissedVersion: RELEASE.version })
    mount('update-mobile')
    expect(offered).toEqual(RELEASE)
    expect(checker.checkNow).not.toHaveBeenCalled()
  })

  it('does not re-check on a remount within the hour of a check that found nothing', () => {
    checker.publish({ lastCheckedAt: NOW })
    vi.setSystemTime(NOW + APP_UPDATE_RETRY_INTERVAL_MS - 1)
    mount('update-mobile')
    unmount()
    mount('update-mobile')
    expect(checker.checkNow).not.toHaveBeenCalled()
  })

  it('checks once on a remount after the hour', () => {
    checker.publish({ lastCheckedAt: NOW })
    vi.setSystemTime(NOW + APP_UPDATE_RETRY_INTERVAL_MS)
    mount('update-mobile')
    expect(checker.checkNow).toHaveBeenCalledTimes(1)
  })

  it.each(['update-desktop', 'refresh-bundle', null] as const)('never checks for %s', (remedy) => {
    mount(remedy)
    act(() => renderer?.update(createElement(Probe, { remedy })))
    expect(checker.checkNow).not.toHaveBeenCalled()
  })
})

describe('the page form of useBlockedShellAppUpdate', () => {
  it.each(['update-mobile', 'update-desktop', 'refresh-bundle', null] as const)(
    'offers nothing for %s',
    (remedy) => {
      expect(usePageBlockedShellAppUpdate(remedy)).toBeNull()
    }
  )

  it('imports only types, so the page bundle never carries the checker', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'use-blocked-shell-app-update.web.ts'),
      'utf8'
    )
    const imports = source.split('\n').filter((line) => line.startsWith('import'))
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.every((line) => line.startsWith('import type '))).toBe(true)
  })
})
