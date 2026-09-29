import { useEffect } from 'react'
import type { BlockRemedy } from '../components/ProtocolBlockScreen'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { appUpdateChecker, useAppUpdateState } from './app-update-runtime'

/**
 * The release a shell-rendered wall offers. Shell-only: the page closure must never carry the
 * checker. Dismissal is ignored because this release is the way past the wall.
 */
export function useBlockedShellAppUpdate(remedy: BlockRemedy | null): KnownAppUpdate | null {
  const { available } = useAppUpdateState()
  // Keyed on the remedy alone, so a published result re-renders without re-checking.
  useEffect(() => {
    if (remedy === 'update-mobile') {
      void appUpdateChecker.checkNow()
    }
  }, [remedy])
  return available
}
