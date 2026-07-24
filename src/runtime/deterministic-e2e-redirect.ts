/**
 * Test-build guard for DNR-based local mock redirects.
 *
 * Deterministic E2E redirects provider requests to a local server through a
 * session DNR rule. Chrome exposes that rewrite to fetch as a redirect, while
 * production requests deliberately fail closed on redirects. Keep the escape
 * hatch centralized, compiled out of normal builds, and restricted to a
 * loopback response with an explicit port.
 */
export const allowsDeterministicE2eRedirect =
  typeof __TAKO_E2E_STATE_SEED__ !== "undefined" && __TAKO_E2E_STATE_SEED__

export function isDeterministicE2eMockResponseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port.length > 0
    )
  } catch {
    return false
  }
}

export function shouldAcceptDeterministicE2eMockResponse(
  responseUrl: string | undefined
): boolean {
  return (
    allowsDeterministicE2eRedirect &&
    typeof responseUrl === "string" &&
    isDeterministicE2eMockResponseUrl(responseUrl)
  )
}
