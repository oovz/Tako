import { describe, expect, it } from 'vitest'

import { __shouldReloadSiteOverridesForTests } from '@/src/ui/shared/hooks/useSiteOverrides'

describe('useSiteOverrides helpers', () => {
  it('reloads only when the canonical site overrides storage key changes in local storage', () => {
    const storageKey = 'siteOverrides:canonical-test'

    expect(
      __shouldReloadSiteOverridesForTests(
        {
          [storageKey]: { newValue: {} },
        } as Record<string, chrome.storage.StorageChange>,
        'local',
        storageKey,
      ),
    ).toBe(true)

    expect(
      __shouldReloadSiteOverridesForTests(
        {
          siteOverrides: { newValue: {} },
        } as Record<string, chrome.storage.StorageChange>,
        'local',
        storageKey,
      ),
    ).toBe(false)

    expect(
      __shouldReloadSiteOverridesForTests(
        {
          [storageKey]: { newValue: {} },
        } as Record<string, chrome.storage.StorageChange>,
        'sync',
        storageKey,
      ),
    ).toBe(false)
  })
})

