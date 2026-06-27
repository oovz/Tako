import { describe, expect, it } from 'vitest'

import { __shouldReloadSiteOverridesForTests } from '@/src/ui/shared/hooks/useSiteOverrides'
import { SITE_OVERRIDES_STORAGE_KEY } from '@/src/storage/site-overrides-service'

describe('__shouldReloadSiteOverridesForTests', () => {
  it('returns true when local area has new value for the storage key', () => {
    const changes = {
      [SITE_OVERRIDES_STORAGE_KEY]: { newValue: { mangadex: { outputFormat: 'cbz' } } },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'local')).toBe(true)
  })

  it('returns false when area is not local', () => {
    const changes = {
      [SITE_OVERRIDES_STORAGE_KEY]: { newValue: { mangadex: {} } },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'session')).toBe(false)
  })

  it('returns false when the storage key is not in changes', () => {
    const changes = {
      someOtherKey: { newValue: 'foo' },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'local')).toBe(false)
  })

  it('returns false when newValue is falsy (deletion)', () => {
    const changes = {
      [SITE_OVERRIDES_STORAGE_KEY]: { oldValue: { mangadex: {} }, newValue: undefined },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'local')).toBe(false)
  })

  it('returns false for empty changes object', () => {
    expect(__shouldReloadSiteOverridesForTests({}, 'local')).toBe(false)
  })

  it('respects custom storage key parameter', () => {
    const customKey = 'customOverrides'
    const changes = {
      [customKey]: { newValue: { foo: {} } },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'local', customKey)).toBe(true)
    expect(__shouldReloadSiteOverridesForTests(changes, 'local', 'wrongKey')).toBe(false)
  })

  it('returns true when newValue is an empty object (truthy)', () => {
    const changes = {
      [SITE_OVERRIDES_STORAGE_KEY]: { newValue: {} },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'local')).toBe(true)
  })

  it('returns false when newValue is null', () => {
    const changes = {
      [SITE_OVERRIDES_STORAGE_KEY]: { newValue: null },
    }

    expect(__shouldReloadSiteOverridesForTests(changes, 'local')).toBe(false)
  })
})
