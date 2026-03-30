import { describe, expect, it } from 'vitest'

import { SITE_INTEGRATION_MANIFESTS, getManifest, isEnabled } from '@/src/site-integrations/registry'

describe('site integration registry', () => {
  it('re-exports the canonical manifest list', () => {
    expect(SITE_INTEGRATION_MANIFESTS.length).toBeGreaterThan(0)
  })

it('declares chapter policy concurrency as 1 for all manifests', () => {
    expect(SITE_INTEGRATION_MANIFESTS.every((manifest) => manifest.policyDefaults.chapter.concurrency === 1)).toBe(true)
  })

  it('uses directory-scoped runtime entry modules for manifest imports', () => {
    expect(SITE_INTEGRATION_MANIFESTS.every((manifest) => manifest.importPath.endsWith('/runtime'))).toBe(true)
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
