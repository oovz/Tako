import { describe, expect, it } from 'vitest'

import { SITE_INTEGRATION_MANIFESTS, getManifest, isEnabled } from '@/src/site-integrations/registry'

describe('site integration registry', () => {
  it('re-exports the canonical manifest list', () => {
    expect(SITE_INTEGRATION_MANIFESTS.length).toBeGreaterThan(0)
  })

  it('keeps production manifests free of test-only domains', () => {
    expect(
      SITE_INTEGRATION_MANIFESTS.every((manifest) =>
        manifest.patterns.domains.every((domain) => !domain.endsWith('.test')),
      ),
    ).toBe(true)
  })

  it('declares usable manifest contracts for runtime resolution', () => {
    for (const manifest of SITE_INTEGRATION_MANIFESTS) {
      expect(manifest.id).toBeTruthy()
      expect(manifest.name).toBeTruthy()
      expect(manifest.exportName).toBeTruthy()
      expect(manifest.importPath).toBeTruthy()
      expect(manifest.patterns.domains.length).toBeGreaterThan(0)
      expect(manifest.patterns.seriesMatches.length).toBeGreaterThan(0)
      expect(manifest.patterns.seriesMatches.every((match) => match.startsWith('/'))).toBe(true)
    }
  })

  it('returns null when manifest is missing', () => {
    expect(getManifest('__unknown__')).toBeNull()
  })

  it('returns manifest when integration id exists', () => {
    const manifest = SITE_INTEGRATION_MANIFESTS[0]
    expect(manifest).toBeDefined()
    if (!manifest) {
      throw new Error('Expected at least one manifest')
    }
    expect(getManifest(manifest.id)?.id).toBe(manifest.id)
  })

  it('treats integration as enabled by default', () => {
    const manifest = SITE_INTEGRATION_MANIFESTS.find((item) => item.enabled !== false)
    expect(manifest).toBeDefined()
    if (!manifest) {
      throw new Error('Expected at least one enabled manifest')
    }

    expect(isEnabled(manifest.id, {})).toBe(true)
  })

  it('applies user override when provided', () => {
    const manifest = SITE_INTEGRATION_MANIFESTS.find((item) => item.enabled !== false)
    expect(manifest).toBeDefined()
    if (!manifest) {
      throw new Error('Expected at least one enabled manifest')
    }

    expect(isEnabled(manifest.id, { [manifest.id]: false })).toBe(false)
    expect(isEnabled(manifest.id, { [manifest.id]: true })).toBe(true)
  })
})
