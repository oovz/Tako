/** Page-probe contracts shared by providers and the generated registry. */

/**
 * A provider-owned page probe. The browser serializes `collect` for the page’s
 * isolated world. It must be self-contained and return JSON-serializable data.
 * Parsing runs in the extension background.
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
