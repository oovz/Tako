import { describe, expect, it } from 'vitest'

import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'

describe('set-session-format legacy removal', () => {
  it('does not expose the removed sessionFormat session key', () => {
    expect('sessionFormat' in SESSION_STORAGE_KEYS).toBe(false)
  })
})

