/**
 * Leaf module for the page-probe contract. Neither the generated probe
 * registry nor any provider probe may import a module that imports them;
 * hosting the contract here keeps the import graph acyclic.
 */

/**
 * A reviewed, provider-owned page probe. `collect` is serialized by Chrome
 * and therefore must be self-contained: it may only use globals available in
 * the page's isolated world. Parsing always runs in the service worker.
 */
export interface SiteIntegrationPageProbe {
  id: string
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
