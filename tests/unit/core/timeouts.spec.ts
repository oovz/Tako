import { describe, expect, it } from 'vitest'

import {
  STALL_TIMEOUT_MS,
  HARD_TIMEOUT_MS,
  LIVENESS_TIMEOUT_MS,
  IPC_THROTTLE_MS,
  TRANSITION_DURATION_MS,
} from '@/src/constants/timeouts'

describe('timeouts constants', () => {
  it('matches command center contract values', () => {
    expect(STALL_TIMEOUT_MS).toBe(30_000)
    expect(HARD_TIMEOUT_MS).toBe(150_000)
    expect(LIVENESS_TIMEOUT_MS).toBe(60_000)
    expect(IPC_THROTTLE_MS).toBe(250)
    expect(TRANSITION_DURATION_MS).toBe(275)
  })

  it('keeps timeout ordering sane', () => {
    expect(HARD_TIMEOUT_MS).toBeGreaterThan(STALL_TIMEOUT_MS)
    expect(LIVENESS_TIMEOUT_MS).toBeGreaterThan(IPC_THROTTLE_MS)
  })
})
