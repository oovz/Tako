import { describe, expect, it } from 'vitest'

import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { normalizeInitFailureState } from '@/entrypoints/sidepanel/hooks/useInitFailure'

describe('useInitFailure normalizeInitFailureState', () => {
  it('returns default state for invalid payloads', () => {
    expect(normalizeInitFailureState(undefined)).toEqual({ initFailed: false, error: undefined })
    expect(normalizeInitFailureState(null)).toEqual({ initFailed: false, error: undefined })
    expect(normalizeInitFailureState('bad')).toEqual({ initFailed: false, error: undefined })
  })

  it('returns normalized init failure state from session payload', () => {
    expect(
      normalizeInitFailureState({
        [SESSION_STORAGE_KEYS.initFailed]: true,
        error: 'storage corruption',
      }),
    ).toEqual({
      initFailed: true,
      error: 'storage corruption',
    })
  })

  it('ignores non-string error values', () => {
    expect(
      normalizeInitFailureState({
        [SESSION_STORAGE_KEYS.initFailed]: true,
        error: 42,
      }),
    ).toEqual({
      initFailed: true,
      error: undefined,
    })
  })
})

