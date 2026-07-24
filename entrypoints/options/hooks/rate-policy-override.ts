import type { RateScopePolicy } from "@/src/types/rate-policy"

export function normalizeImagePolicyOverride(
  value: Partial<RateScopePolicy>
): Partial<RateScopePolicy> | undefined {
  return value.concurrency != null || value.delayMs != null ? value : undefined
}

export function normalizeRetryOverride(value: {
  image?: number
  chapter?: number
}): { image?: number; chapter?: number } | undefined {
  const normalized = {
    ...(value.image != null ? { image: value.image } : {}),
    ...(value.chapter != null ? { chapter: value.chapter } : {}),
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}
