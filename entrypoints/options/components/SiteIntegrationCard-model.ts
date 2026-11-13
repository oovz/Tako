import type { SiteOverrideRecord } from "@/src/domain/site-integrations/storage-schemas"

export function hasSiteOverrides(override: SiteOverrideRecord | undefined) {
  return (
    override?.outputFormat !== undefined ||
    override?.pathTemplate !== undefined ||
    override?.imagePolicy?.concurrency !== undefined ||
    override?.imagePolicy?.delayMs !== undefined ||
    override?.chapterPolicy?.delayMs !== undefined ||
    override?.retries?.image !== undefined ||
    override?.retries?.chapter !== undefined
  )
}

/** Undefined fields remove overrides; an empty record inherits the global policy. */
export function updateSiteOverride(
  current: SiteOverrideRecord | undefined,
  updates: Partial<SiteOverrideRecord>
): SiteOverrideRecord | null {
  const next = { ...current, ...updates }
  for (const key of Object.keys(next) as (keyof SiteOverrideRecord)[]) {
    if (next[key] === undefined) delete next[key]
  }
  return hasSiteOverrides(next) ? next : null
}
