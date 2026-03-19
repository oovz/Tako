import { describe, expect, it } from 'vitest'

import { getInitialOptionsSection } from '@/entrypoints/options/tab-routing'

describe('options tab routing', () => {
  it('maps integrations deep-link query to integrations section', () => {
    expect(getInitialOptionsSection('?tab=integrations')).toBe('integrations')
  })

  it('returns global for unknown tabs and invalid query strings', () => {
    expect(getInitialOptionsSection('?tab=legacy-integrations')).toBe('global')
    expect(getInitialOptionsSection('?tab=unknown')).toBe('global')
    expect(getInitialOptionsSection('::not-a-query')).toBe('global')
  })

  it('returns global when no tab parameter is present', () => {
    expect(getInitialOptionsSection('')).toBe('global')
    expect(getInitialOptionsSection('?foo=bar')).toBe('global')
  })
})
