import { describe, expect, it } from 'vitest'

import { shouldMountInlineSelection } from '@/entrypoints/sidepanel/SidePanelApp'

describe('SidePanelApp inline selection mounting', () => {
  it('does not mount inline selection subtree when panel is collapsed', () => {
    expect(shouldMountInlineSelection(false)).toBe(false)
  })

  it('mounts inline selection subtree only when panel is expanded', () => {
    expect(shouldMountInlineSelection(true)).toBe(true)
  })
})

