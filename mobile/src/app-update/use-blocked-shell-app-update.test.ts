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
import type { AppUpdatePreferences, KnownAppUpdate } from '../storage/app-update-preferences'
import { createAppUpdateChecker } from './app-update-checker'
import type { AppUpdateCheckResult } from './app-update-source'
import { useBlockedShellAppUpdate } from './use-blocked-shell-app-update'
import { useBlockedShellAppUpdate as usePageBlockedShellAppUpdate } from './use-blocked-shell-app-update.web'

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

type Checker = ReturnType<typeof createAppUpdateChecker>
const runtime = vi.hoisted(() => {
  const state: { checker: Checker | null } = { checker: null }
  const current = (): Checker => {
    if (!state.checker) {
      throw new Error('no checker for this test')
    }
    return state.checker
  }
  return { state, current, checkIfDue: vi.fn(() => current().checkIfDue()) }
})

// The real checker behind the runtime's name: the cadence under test is the checker's own.
vi.mock('./app-update-runtime', () => ({
  appUpdateChecker: {
    checkNow: () => runtime.current().checkNow(),
    checkIfDue: runtime.checkIfDue,
    getSnapshot: () => runtime.current().getSnapshot(),
    subscribe: (listener: () => void) => runtime.current().subscribe(listener)
  },
  useAppUpdateState: () =>
    useSyncExternalStore(
      (listener) => runtime.current().subscribe(listener),
      () => runtime.current().getSnapshot()
    )
}))

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 8, 29, 12)
const RELEASE = { version: '0.0.52', url: 'https://example.test/0.0.52' }
const UPDATE_MOBILE_VERDICTS: BlockedVerdict[] = [
  { kind: 'blocked', reason: 'mobile-too-old', desktopVersion: 5, requiredMobileVersion: 9 },
  { kind: 'blocked', reason: 'bundle-shell-too-old', schemaVersion: 2 }
]
let renderer: ReactTestRenderer | null = null
let offered: KnownAppUpdate | null = null
let lookups = vi.fn<() => Promise<AppUpdateCheckResult>>()

/** Started, as app/_layout starts it; `replies` answer the store lookup in order. */
function startChecker(opts: {
  stored?: Partial<AppUpdatePreferences>
  replies?: (AppUpdateCheckResult | Error)[]
}): void {
  const replies = [...(opts.replies ?? [])]
  lookups = vi.fn(async () => {
    const reply = replies.shift() ?? { kind: 'current' }
    if (reply instanceof Error) {
      throw reply
    }
    return reply
  })
  runtime.state.checker = createAppUpdateChecker({
    source: { check: lookups },
    installedVersion: '0.0.48',
    now: () => Date.now(),
    setTimer: (run, delayMs) => setTimeout(run, delayMs),
    clearTimer: (handle) => clearTimeout(handle),
    subscribeForeground: () => () => {},
    loadPreferences: async () => ({
      lastCheckedAt: null,
      latest: null,
      dismissedVersion: null,
      ...opts.stored
    }),
    saveCheck: async () => {},
    saveDismissedVersion: async () => {}
  })
  runtime.state.checker.start()
}

function Probe({ remedy }: { remedy: BlockRemedy | null }) {
  offered = useBlockedShellAppUpdate(remedy)
  return null
}

async function mount(remedy: BlockRemedy | null): Promise<void> {
  await act(async () => {
    renderer = create(createElement(Probe, { remedy }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function unmount(): void {
  act(() => renderer?.unmount())
  renderer = null
}

describe('useBlockedShellAppUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
    runtime.checkIfDue.mockClear()
  })

  afterEach(() => {
    unmount()
    runtime.state.checker = null
    vi.useRealTimers()
  })

  it.each(UPDATE_MOBILE_VERDICTS)('asks for a check on the $reason wall', async (verdict) => {
    startChecker({})
    await mount(blockRemedy(verdict))
    expect(runtime.checkIfDue).toHaveBeenCalledTimes(1)
    expect(lookups).toHaveBeenCalledTimes(1)
  })

  it('offers the found release and does not ask again when it is published', async () => {
    startChecker({ replies: [{ kind: 'available', ...RELEASE }] })
    await mount('update-mobile')
    expect(offered).toEqual(RELEASE)
    expect(runtime.checkIfDue).toHaveBeenCalledTimes(1)
    expect(lookups).toHaveBeenCalledTimes(1)
  })

  it('offers a release dismissed on home, because it is the way past the wall', async () => {
    startChecker({
      stored: { lastCheckedAt: T0, latest: RELEASE, dismissedVersion: RELEASE.version }
    })
    await mount('update-mobile')
    expect(offered).toEqual(RELEASE)
  })

  it('does not look up again on a remount within the hour of a failed lookup', async () => {
    startChecker({ replies: [new Error('403')] })
    await elapse(0)
    await elapse(HOUR / 2)
    await mount('update-mobile')
    unmount()
    await mount('update-mobile')
    expect(lookups).toHaveBeenCalledTimes(1)
  })

  it('does not look up again on a remount within a day of a lookup that found nothing', async () => {
    startChecker({})
    await elapse(0)
    await elapse(23 * HOUR)
    await mount('update-mobile')
    expect(lookups).toHaveBeenCalledTimes(1)
  })

  it('does not look up at cold start when the stored lookup is an hour old', async () => {
    startChecker({ stored: { lastCheckedAt: T0 - HOUR } })
    await mount('update-mobile')
    expect(lookups).not.toHaveBeenCalled()
  })

  it.each(['update-desktop', 'refresh-bundle', null] as const)(
    'never asks for %s',
    async (remedy) => {
      startChecker({ stored: { lastCheckedAt: T0 } })
      await mount(remedy)
      expect(runtime.checkIfDue).not.toHaveBeenCalled()
    }
  )
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
