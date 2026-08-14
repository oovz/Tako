import { vi } from "vitest"
import type { RateLimitService } from "@/src/runtime/rate-limit"

export const mockRateLimitedFetch = vi.fn()
export const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService
export const rateLimitSettings = {
  image: { concurrency: 1, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

export const makeHtmlResponse = (
  html: string,
  contentType = "text/html; charset=utf-8"
) => ({
  ok: true,
  headers: {
    get: (name: string) => (name === "content-type" ? contentType : null),
  },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
})

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  getRateLimitPolicyFromSnapshot: vi.fn(() => undefined),
  scheduleForIntegrationScope: vi.fn(
    async (_integrationId: string, _scope: string, task: () => unknown) =>
      task()
  ),
}))

vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: {
    request: (...args: unknown[]) => mockRateLimitedFetch(...args),
  },
  fetchSharedResource: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

export type BrowserGlobalsSnapshot = {
  windowValue: typeof global.window
  documentValue: typeof global.document
  fetchValue: typeof global.fetch
}

export function captureBrowserGlobals(): BrowserGlobalsSnapshot {
  return {
    windowValue: global.window,
    documentValue: global.document,
    fetchValue: global.fetch,
  }
}

export function setTestWindow(value: any): void {
  Object.defineProperty(global, "window", {
    value,
    configurable: true,
  })
}

export function setTestDocument(value: any): void {
  Object.defineProperty(global, "document", {
    value,
    configurable: true,
  })
}

export function setTestFetch(value: any): void {
  Object.defineProperty(global, "fetch", {
    value,
    configurable: true,
  })
}

export function restoreBrowserGlobals(snapshot: BrowserGlobalsSnapshot): void {
  setTestWindow(snapshot.windowValue)
  setTestDocument(snapshot.documentValue)
  setTestFetch(snapshot.fetchValue)
}

export { compressToBase64 } from "../../shared/manhuagui-compress"

export function resetManhuaguiTestEnvironment(): void {
  vi.clearAllMocks()
  mockRateLimitedFetch.mockReset()
}
