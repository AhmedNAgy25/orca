import { useEffect } from 'react'
import type { BlockRemedy } from '../components/ProtocolBlockScreen'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { APP_UPDATE_RETRY_INTERVAL_MS } from './app-update-checker'
import { appUpdateChecker, useAppUpdateState } from './app-update-runtime'

/**
 * The release a wall offers. Dismissal is ignored because this release is the way past the wall.
 * The page resolves the `.web.ts` sibling, so its bundle never carries the checker.
 */
export function useBlockedShellAppUpdate(remedy: BlockRemedy | null): KnownAppUpdate | null {
  const { available } = useAppUpdateState()
  // Keyed on the remedy alone, so a published result re-renders without re-checking.
  useEffect(() => {
    if (remedy === 'update-mobile' && checkIsWorthAnotherCall(Date.now())) {
      void appUpdateChecker.checkNow()
    }
  }, [remedy])
  return available
}

// A flapping host remounts the wall; each check is an unauthenticated GitHub call (60/hour/IP).
function checkIsWorthAnotherCall(now: number): boolean {
  const { available, lastCheckedAt } = appUpdateChecker.getSnapshot()
  return (
    available === null &&
    (lastCheckedAt === null || now - lastCheckedAt >= APP_UPDATE_RETRY_INTERVAL_MS)
  )
}
