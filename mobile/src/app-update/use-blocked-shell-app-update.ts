import { useEffect } from 'react'
import type { BlockRemedy } from '../components/ProtocolBlockScreen'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { appUpdateChecker, useAppUpdateState } from './app-update-runtime'

/**
 * The release a wall offers. Dismissal is ignored because this release is the way past the wall.
 * The page resolves the `.web.ts` sibling, so its bundle never carries the checker.
 */
export function useBlockedShellAppUpdate(remedy: BlockRemedy | null): KnownAppUpdate | null {
  const { available } = useAppUpdateState()
  // Keyed on the remedy alone, so a published result re-renders without asking again.
  useEffect(() => {
    if (remedy === 'update-mobile') {
      appUpdateChecker.checkIfDue()
    }
  }, [remedy])
  return available
}
