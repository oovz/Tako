import { vi } from "vitest"

export const mockRateLimitedFetch = vi.fn()

export function makePngHeader(width = 32, height = 32): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
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
  rateLimitedFetchForIntegration: (
    _integrationId: string,
    ...args: unknown[]
  ) => mockRateLimitedFetch(...args),
  rateLimitedFetchByUrlScope: (...args: unknown[]) =>
    mockRateLimitedFetch(...args),
  getRateLimitPolicyFromContext: vi.fn(() => undefined),
  getRateLimitPolicyFromSnapshot: vi.fn(() => undefined),
}))

vi.mock("@/src/site-integrations/manifest", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/src/site-integrations/manifest")>()
  return {
    ...original,
    getPatternBySiteIntegrationId: vi.fn(() => ({
      domains: ["comic.pixiv.net"],
      seriesMatches: ["/works/*"],
    })),
  }
})

vi.mock("@/src/types/site-integrations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/src/types/site-integrations")>()
  return {
    ...original,
    IntegrationContextValidator: {
      validateContentScriptContext: vi.fn(),
      validateBackgroundOrOffscreenContext: vi.fn(),
    },
  }
})

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

export function resetPixivComicTestEnvironment(): void {
  vi.clearAllMocks()
  mockRateLimitedFetch.mockReset()
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() }))
  )
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number
      ) {}
      getContext() {
        return {
          drawImage: vi.fn(),
          getImageData: () => ({
            data: new Uint8ClampedArray(this.width * this.height * 4),
          }),
          createImageData: () => ({
            data: new Uint8ClampedArray(this.width * this.height * 4),
          }),
          putImageData: vi.fn(),
        }
      }
      convertToBlob(options: { type: string }) {
        return Promise.resolve(new Blob([new Uint8Array([1])], options))
      }
    }
  )
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      mockRateLimitedFetch(input, "image", init)
    )
  )
  vi.useRealTimers()
}

export function cleanupPixivComicTestEnvironment(): void {
  vi.unstubAllGlobals()
  vi.useRealTimers()
}
