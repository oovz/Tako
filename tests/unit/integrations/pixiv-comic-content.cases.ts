import { describe, expect, it, vi } from 'vitest';
import {
  captureBrowserGlobals,
  restoreBrowserGlobals,
  setTestDocument,
  setTestWindow,
} from './pixiv-comic-test-setup';

export function registerPixivComicContentCases(): void {
  describe('Pixiv Comic integration', () => {
    it('extracts work id from /works/{id}', async () => {
      const snapshot = captureBrowserGlobals();
      setTestWindow({ location: { pathname: '/works/9012' } });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      expect(pixivComicIntegration.content.series.getSeriesId()).toBe('9012');

      restoreBrowserGlobals(snapshot);
    });

    it('extracts work id from og:url metadata when on viewer route', async () => {
      const snapshot = captureBrowserGlobals();

      setTestWindow({
        location: {
          origin: 'https://comic.pixiv.net',
          pathname: '/viewer/stories/44495',
        },
      });

      setTestDocument({
        querySelector: vi.fn((selector: string) => {
          if (selector === 'meta[property="og:url"]') {
            return { getAttribute: () => 'https://comic.pixiv.net/works/9012' };
          }
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      expect(pixivComicIntegration.content.series.getSeriesId()).toBe('9012');

      restoreBrowserGlobals(snapshot);
    });

    it('waitForPageReady resolves immediately when the work id is already in the pathname', async () => {
      const observe = vi.fn();
      const disconnect = vi.fn();

      class MockMutationObserver {
        observe = observe;
        disconnect = disconnect;

        constructor(_callback: MutationCallback) {}
      }

      vi.stubGlobal('window', {
        location: {
          origin: 'https://comic.pixiv.net',
          pathname: '/works/9012',
        },
      });

      vi.stubGlobal('document', {
        querySelector: vi.fn(() => null),
        documentElement: {},
        body: {},
        head: {},
      });

      vi.stubGlobal('MutationObserver', MockMutationObserver);

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');

      await expect(pixivComicIntegration.content.series.waitForPageReady?.()).resolves.toBeUndefined();
      expect(observe).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('waitForPageReady resolves when Pixiv metadata hydrates via DOM mutation', async () => {
      vi.useFakeTimers();

      let metadataUrl: string | null = null;
      const observe = vi.fn();
      const disconnect = vi.fn();
      let mutationCallback: MutationCallback | undefined;

      class MockMutationObserver {
        observe = observe;
        disconnect = disconnect;

        constructor(callback: MutationCallback) {
          mutationCallback = callback;
        }
      }

      vi.stubGlobal('window', {
        location: {
          origin: 'https://comic.pixiv.net',
          pathname: '/viewer/stories/44495',
        },
      });

      vi.stubGlobal('document', {
        querySelector: vi.fn((selector: string) => {
          if (selector === 'meta[property="og:url"]') {
            return metadataUrl ? { getAttribute: () => metadataUrl } : null;
          }

          return null;
        }),
        documentElement: {},
        body: {},
        head: {},
      });

      vi.stubGlobal('MutationObserver', MockMutationObserver);

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');

      const readyPromise = pixivComicIntegration.content.series.waitForPageReady?.();
      await Promise.resolve();

      expect(observe).toHaveBeenCalledTimes(1);
      expect(mutationCallback).toBeTypeOf('function');

      metadataUrl = 'https://comic.pixiv.net/works/9012';
      mutationCallback?.([], {} as MutationObserver);

      await expect(readyPromise).resolves.toBeUndefined();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('omits optional content-side chapter and metadata extractors because Pixiv uses API extraction', async () => {
      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');

      expect(pixivComicIntegration.content.series.extractChapterList).toBeUndefined();
      expect(pixivComicIntegration.content.series.extractSeriesMetadata).toBeUndefined();
    });
  });
}
