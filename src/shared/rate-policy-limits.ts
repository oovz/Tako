export const RATE_POLICY_LIMITS = Object.freeze({
  MIN_CONCURRENCY: 1,
  MAX_CONCURRENCY: 10,
  MIN_DELAY_MS: 0,
  MAX_DELAY_MS: 5000,
})

export function clampRatePolicyInteger(
  value: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}

export function parseOptionalRatePolicyInteger(
  value: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value.trim() === "") {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? clampRatePolicyInteger(parsed, minimum, maximum)
    : undefined
}
