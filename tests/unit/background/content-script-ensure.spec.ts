import { describe, expect, it } from 'vitest'

import { shouldSkipContentScriptEnsure } from '@/entrypoints/background/content-script-ensure'

describe('content script ensure throttling', () => {
  it('skips reinjection when the last ensure attempt was recent and force is false', () => {
    expect(shouldSkipContentScriptEnsure({
      lastAttemptTimestamp: 1_000,
      now: 1_500,
      force: false,
    })).toBe(true)
  })

  it('does not skip reinjection when force is true even if the last attempt was recent', () => {
    expect(shouldSkipContentScriptEnsure({
      lastAttemptTimestamp: 1_000,
      now: 1_500,
      force: true,
    })).toBe(false)
  })

  it('does not skip reinjection when the throttle window has elapsed', () => {
    expect(shouldSkipContentScriptEnsure({
      lastAttemptTimestamp: 1_000,
      now: 2_100,
      force: false,
    })).toBe(false)
  })
})

