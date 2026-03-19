import { useCallback } from 'react';
import {
  siteOverridesService,
  SITE_OVERRIDES_STORAGE_KEY,
  normalizeSiteOverridesMap,
  type SiteOverridesMap,
  type SiteOverrideRecord,
} from '@/src/storage/site-overrides-service';
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue';

export function __shouldReloadSiteOverridesForTests(
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
  storageKey: string = SITE_OVERRIDES_STORAGE_KEY,
): boolean {
  return area === 'local' && !!changes[storageKey]?.newValue
}

export function useSiteOverrides() {
    const { value: overrides, hydrated } = useChromeStorageValue<SiteOverridesMap>({
        areaName: 'local',
        key: SITE_OVERRIDES_STORAGE_KEY,
        initialValue: {},
        parse: normalizeSiteOverridesMap,
    });

    const updateSiteOverride = useCallback(async (siteId: string, updates: SiteOverrideRecord) => {
        await siteOverridesService.updateForSite(siteId, updates);
    }, []);

    const removeSiteOverride = useCallback(async (siteId: string) => {
        await siteOverridesService.removeSite(siteId);
    }, []);

    return { overrides, updateSiteOverride, removeSiteOverride, loading: !hydrated };
}

