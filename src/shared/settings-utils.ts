import { siteOverridesService } from "@/src/storage/site-overrides-service"
import { SETTINGS_LIMITS } from "@/src/storage/settings-service"
import type { ExtensionSettings } from "@/src/storage/settings-types"

/**
 * Resolve effective retry counts: site override > global settings.
 * Values are clamped to SETTINGS_LIMITS to guard against corrupted override data.
 */
export async function resolveEffectiveRetries(
  integrationId: string | undefined,
  settings?: ExtensionSettings
): Promise<{ image: number; chapter: number }> {
  const fallback = settings?.globalRetries ?? { image: 3, chapter: 3 }
  try {
    if (!integrationId) return fallback
    const overrides = await siteOverridesService.getAll()
    const o = overrides[integrationId]
    if (o?.retries && (o.retries.image != null || o.retries.chapter != null)) {
      return {
        image:
          typeof o.retries.image === "number"
            ? Math.min(
                SETTINGS_LIMITS.MAX_RETRIES,
                Math.max(SETTINGS_LIMITS.MIN_RETRIES, o.retries.image)
              )
            : fallback.image,
        chapter:
          typeof o.retries.chapter === "number"
            ? Math.min(
                SETTINGS_LIMITS.MAX_RETRIES,
                Math.max(SETTINGS_LIMITS.MIN_RETRIES, o.retries.chapter)
              )
            : fallback.chapter,
      }
    }
  } catch {
    // ignore and fallback
  }
  return fallback
}
