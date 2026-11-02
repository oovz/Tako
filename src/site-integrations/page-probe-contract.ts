/** Page-probe contracts shared by providers and the generated registry. */

/**
 * A provider-owned page probe. `collect` is serialized by Chrome
 * and therefore must be self-contained: it may only use globals available in
 * the page's isolated world. Parsing always runs in the service worker.
 */
export interface SiteIntegrationPageProbe {
  collect: () => unknown
  parse: (raw: unknown) => {
    url: string
    data?: unknown
  }
}

export type SiteIntegrationPageProbeResult = {
  url: string
  data?: unknown
}
