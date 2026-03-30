import { vi } from 'vitest';

export const mockRateLimitedFetch = vi.fn();

export const makeHtmlResponse = (html: string, contentType = 'text/html; charset=utf-8') => ({
  ok: true,
  headers: {
    get: (name: string) => (name === 'content-type' ? contentType : null),
  },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
});

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/src/runtime/rate-limit', () => ({
  rateLimitedFetchByUrlScope: (...args: unknown[]) => mockRateLimitedFetch(...args),
}));

vi.mock('@/src/site-integrations/manifest', () => ({
  getPatternBySiteIntegrationId: vi.fn(() => ({
    domains: ['comic.pixiv.net'],
    seriesMatches: ['/works/*'],
  })),
}));

vi.mock('@/src/types/site-integrations', async importOriginal => {
  const original = await importOriginal<typeof import('@/src/types/site-integrations')>();
  return {
    ...original,
    IntegrationContextValidator: {
      validateContentScriptContext: vi.fn(),
      validateBackgroundOrOffscreenContext: vi.fn(),
    },
  };
});

export type BrowserGlobalsSnapshot = {
  windowValue: typeof global.window;
  documentValue: typeof global.document;
  fetchValue: typeof global.fetch;
};

export function captureBrowserGlobals(): BrowserGlobalsSnapshot {
  return {
    windowValue: global.window,
    documentValue: global.document,
    fetchValue: global.fetch,
  };
}

export function setTestWindow(value: any): void {
  Object.defineProperty(global, 'window', {
    value,
    configurable: true,
  });
}

export function setTestDocument(value: any): void {
  Object.defineProperty(global, 'document', {
    value,
    configurable: true,
  });
}

export function setTestFetch(value: any): void {
  Object.defineProperty(global, 'fetch', {
    value,
    configurable: true,
  });
}

export function restoreBrowserGlobals(snapshot: BrowserGlobalsSnapshot): void {
  setTestWindow(snapshot.windowValue);
  setTestDocument(snapshot.documentValue);
  setTestFetch(snapshot.fetchValue);
}

export function resetPixivComicTestEnvironment(): void {
  vi.clearAllMocks();
  mockRateLimitedFetch.mockReset();
  vi.useRealTimers();
}

export function cleanupPixivComicTestEnvironment(): void {
  vi.unstubAllGlobals();
  vi.useRealTimers();
}
