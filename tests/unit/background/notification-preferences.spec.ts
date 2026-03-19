import { describe, expect, it } from 'vitest'

import { areNotificationsEnabled } from '@/entrypoints/background/notification-preferences'

describe('areNotificationsEnabled', () => {
  it('uses settings.notifications when available', () => {
    expect(areNotificationsEnabled({ notifications: false })).toBe(false)
    expect(areNotificationsEnabled({ notifications: true })).toBe(true)
  })

  it('defaults to true when notification setting is absent', () => {
    expect(areNotificationsEnabled(undefined)).toBe(true)
    expect(areNotificationsEnabled({})).toBe(true)
  })
})

