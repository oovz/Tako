import { describe, expect, it } from 'vitest'

import {
  createExtensionUpdateActionItem,
  hasOptionsActionItems,
  parseOptionsActionItems,
} from '@/src/runtime/options-action-items'

describe('options action items', () => {
  it('creates an extension-update action item for Options to render', () => {
    expect(createExtensionUpdateActionItem({ version: '1.2.8', detectedAt: 1234 })).toEqual({
      extensionUpdate: {
        status: 'available',
        version: '1.2.8',
        detectedAt: 1234,
      },
    })
  })

  it('parses malformed stored values as no action items', () => {
    expect(parseOptionsActionItems(null)).toEqual({})
    expect(parseOptionsActionItems({ extensionUpdate: { status: 'done' } })).toEqual({})
    expect(parseOptionsActionItems({ extensionUpdate: { status: 'available', detectedAt: 'now' } })).toEqual({})
  })

  it('detects whether Options has user-visible action items', () => {
    expect(hasOptionsActionItems({})).toBe(false)
    expect(hasOptionsActionItems(createExtensionUpdateActionItem({ detectedAt: 1234 }))).toBe(true)
  })
})
