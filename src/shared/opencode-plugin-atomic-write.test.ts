import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type WriteFileSyncFn = typeof NodeFs.writeFileSync

const { fsMock } = vi.hoisted(() => {
  let realWrite: WriteFileSyncFn | undefined
  return {
    fsMock: {
      writeFileSync: vi.fn(),
      getRealWrite: (): WriteFileSyncFn | undefined => realWrite,
      setRealWrite: (fn: WriteFileSyncFn): void => {
        realWrite = fn
      }
    }
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  fsMock.setRealWrite(actual.writeFileSync)
  fsMock.writeFileSync.mockImplementation((...args: Parameters<WriteFileSyncFn>) =>
    actual.writeFileSync(...args)
  )
  return {
    ...actual,
    writeFileSync: fsMock.writeFileSync
  }
})

import {
  resolveCanonicalPluginWritePath,
  writeCanonicalOpenCodePluginAtomically,
  writeOverlayOpenCodePluginAtomically
} from './opencode-plugin-atomic-write'

afterEach(() => {
  const realWrite = fsMock.getRealWrite()
  if (realWrite) {
    fsMock.writeFileSync.mockImplementation((...args: Parameters<WriteFileSyncFn>) =>
      realWrite(...args)
    )
  }
  vi.clearAllMocks()
})

describe('opencode-plugin-atomic-write', () => {
  it('writes atomically via sibling temp file and never writes directly in place', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'opencode-atomic-write-'))
    const pluginPath = join(testDir, 'plugins', 'orca-opencode-status.js')
    const writtenPaths: string[] = []

    const realWrite = fsMock.getRealWrite()
    expect(realWrite).toBeDefined()
    if (!realWrite) {
      return
    }

    fsMock.writeFileSync.mockImplementation(
      (
        file: Parameters<WriteFileSyncFn>[0],
        data: Parameters<WriteFileSyncFn>[1],
        options: Parameters<WriteFileSyncFn>[2]
      ) => {
        writtenPaths.push(String(file))
        return realWrite(file, data, options)
      }
    )

    try {
      writeCanonicalOpenCodePluginAtomically(pluginPath, 'console.log("hello")')
      expect(readFileSync(pluginPath, 'utf8')).toBe('console.log("hello")')
      expect(writtenPaths).toHaveLength(1)
      expect(writtenPaths[0]).not.toBe(pluginPath)
      expect(writtenPaths[0]).toContain('.orca-opencode-status.js.')
      expect(writtenPaths[0]).toContain('.tmp')
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('preserves symlink and updates underlying target in canonical mode', () => {
    if (process.platform === 'win32') {
      return
    }
    const realWrite = fsMock.getRealWrite()
    expect(realWrite).toBeDefined()
    if (!realWrite) {
      return
    }

    const testDir = mkdtempSync(join(tmpdir(), 'opencode-canonical-symlink-'))
    const pluginsDir = join(testDir, 'plugins')
    mkdirSync(pluginsDir, { recursive: true })
    const realFile = join(testDir, 'dotfiles-plugin.js')
    const linkFile = join(pluginsDir, 'orca-opencode-status.js')

    realWrite(realFile, 'initial content', 'utf8')
    symlinkSync(realFile, linkFile)

    expect(resolveCanonicalPluginWritePath(linkFile)).toBe(realFile)

    writeCanonicalOpenCodePluginAtomically(linkFile, 'updated content')

    expect(lstatSync(linkFile).isSymbolicLink()).toBe(true)
    expect(readFileSync(realFile, 'utf8')).toBe('updated content')
    expect(readFileSync(linkFile, 'utf8')).toBe('updated content')

    rmSync(testDir, { recursive: true, force: true })
  })

  it('replaces symlink in overlay mode without mutating user target file', () => {
    if (process.platform === 'win32') {
      return
    }
    const realWrite = fsMock.getRealWrite()
    expect(realWrite).toBeDefined()
    if (!realWrite) {
      return
    }

    const testDir = mkdtempSync(join(tmpdir(), 'opencode-overlay-symlink-'))
    const pluginsDir = join(testDir, 'overlay', 'plugins')
    mkdirSync(pluginsDir, { recursive: true })
    const userPlugin = join(testDir, 'user-plugin.js')
    const overlayPlugin = join(pluginsDir, 'orca-opencode-status.js')

    realWrite(userPlugin, 'user original source', 'utf8')
    symlinkSync(userPlugin, overlayPlugin)

    writeOverlayOpenCodePluginAtomically(overlayPlugin, 'orca status source')

    expect(lstatSync(overlayPlugin).isSymbolicLink()).toBe(false)
    expect(lstatSync(overlayPlugin).isFile()).toBe(true)
    expect(readFileSync(overlayPlugin, 'utf8')).toBe('orca status source')
    expect(readFileSync(userPlugin, 'utf8')).toBe('user original source')

    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates missing directories automatically when writing plugin', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'opencode-nested-dir-'))
    const deeplyNestedPlugin = join(testDir, 'nested', 'path', 'plugins', 'status.js')

    writeOverlayOpenCodePluginAtomically(deeplyNestedPlugin, 'content')
    expect(existsSync(deeplyNestedPlugin)).toBe(true)
    expect(readFileSync(deeplyNestedPlugin, 'utf8')).toBe('content')

    rmSync(testDir, { recursive: true, force: true })
  })
})
