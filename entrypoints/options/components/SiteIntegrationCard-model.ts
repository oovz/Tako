import type { SiteOverrideRecord } from "@/src/domain/site-integrations/storage-schemas"

/** Undefined fields remove overrides; an empty record inherits the global policy. */
export function updateSiteOverride(
  current: SiteOverrideRecord | undefined,
  updates: Partial<SiteOverrideRecord>
): SiteOverrideRecord | null {
  const next = { ...current, ...updates }
  for (const key of Object.keys(next) as (keyof SiteOverrideRecord)[]) {
    if (next[key] === undefined) delete next[key]
  }
  return Object.keys(next).length > 0 ? next : null
}
