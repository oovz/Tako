import { describe, expect, it } from 'vitest'

import { getTaskStatusLabel } from '@/entrypoints/sidepanel/components/command-center-queue-helpers'

describe('command center task status labels', () => {
  it('uses the explicit Partial success label required by the MVP spec', () => {
    expect(getTaskStatusLabel('partial_success')).toBe('Partial success')
  })
})
