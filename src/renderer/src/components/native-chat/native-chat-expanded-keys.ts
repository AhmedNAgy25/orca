/** How many turns or sections a reader can hold open; past it the oldest closes. */
const MAX_EXPANDED_KEYS = 128

/** Opens or closes `key`, dropping the oldest open one when the set is full. */
export function toggleNativeChatExpandedKey(
  current: ReadonlySet<string>,
  key: string
): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(key)) {
    next.delete(key)
  } else {
    if (next.size >= MAX_EXPANDED_KEYS) {
      const oldest = next.values().next().value
      if (oldest) {
        next.delete(oldest)
      }
    }
    next.add(key)
  }
  return next
}
