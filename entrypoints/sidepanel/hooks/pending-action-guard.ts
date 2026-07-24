export interface PendingActionGuard {
  tryBegin(key: string): boolean
  finish(key: string): void
}

/**
 * Synchronous guard for UI actions whose React pending state is committed on a
 * later render. This closes the same-tick double-activation window without
 * coupling action correctness to render timing.
 */
export function createPendingActionGuard(): PendingActionGuard {
  const pendingKeys = new Set<string>()

  return {
    tryBegin(key: string): boolean {
      if (pendingKeys.has(key)) {
        return false
      }

      pendingKeys.add(key)
      return true
    },
    finish(key: string): void {
      pendingKeys.delete(key)
    },
  }
}
