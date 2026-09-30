import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

function isEnoentError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

// Why: atomic rename on a dotfiles symlink replaces the link itself; resolving realpath updates the target repo file.
export function resolveCanonicalPluginWritePath(pluginPath: string): string {
  try {
    if (lstatSync(pluginPath).isSymbolicLink()) {
      return realpathSync.native(pluginPath)
    }
  } catch (error) {
    if (!isEnoentError(error)) {
      throw error
    }
  }
  return pluginPath
}

// Why: write to sibling temp file and rename so concurrent reloads never observe a truncated or missing file.
function writeAtomicFile(targetPath: string, content: string): void {
  const dir = dirname(targetPath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tmpPath, content, 'utf8')
    try {
      renameSync(tmpPath, targetPath)
    } catch (error) {
      if (process.platform === 'win32') {
        try {
          unlinkSync(targetPath)
          renameSync(tmpPath, targetPath)
          return
        } catch {
          // Fall through to rethrow original error.
        }
      }
      throw error
    }
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // Best effort cleanup.
      }
    }
  }
}

// Why: preserve dotfile symlinks at canonical paths by atomically replacing the real target file.
export function writeCanonicalOpenCodePluginAtomically(pluginPath: string, source: string): void {
  const targetPath = resolveCanonicalPluginWritePath(pluginPath)
  writeAtomicFile(targetPath, source)
}

// Why: replace any mirrored symlink directly in the overlay without following it to the user's config.
export function writeOverlayOpenCodePluginAtomically(pluginPath: string, source: string): void {
  writeAtomicFile(pluginPath, source)
}
