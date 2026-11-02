export type RatePolicySource = "override" | "siteIntegration" | "global"

/** Resolve the displayed value and its provenance in the same precedence walk. */
export function resolveRatePolicyField(
  override: number | undefined,
  siteIntegrationDefault: number | undefined,
  globalDefault: number | undefined,
  fallback: number
): { value: number; source: RatePolicySource } {
  if (override != null) return { value: override, source: "override" }
  if (siteIntegrationDefault != null) {
    return { value: siteIntegrationDefault, source: "siteIntegration" }
  }
  return { value: globalDefault ?? fallback, source: "global" }
}
