import type { KnownAppUpdate } from '../storage/app-update-preferences'

// The page bundle must not carry the checker; the wall inside the page keeps the fallback link.
export function useBlockedShellAppUpdate(): KnownAppUpdate | null {
  return null
}
