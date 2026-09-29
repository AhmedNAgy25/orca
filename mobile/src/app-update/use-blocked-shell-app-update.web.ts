import type { BlockRemedy } from '../components/ProtocolBlockScreen'
import type { KnownAppUpdate } from '../storage/app-update-preferences'

// The page bundle must not carry the checker; the wall inside the page keeps the fallback link.
export function useBlockedShellAppUpdate(_remedy: BlockRemedy | null): KnownAppUpdate | null {
  return null
}
