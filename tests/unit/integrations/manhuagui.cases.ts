import { describe, expect, it, vi } from 'vitest';
import {
  captureBrowserGlobals,
  compressToBase64,
  installChromeMock,
  makeHtmlResponse,
  mockRateLimitedFetch,
  restoreBrowserGlobals,
  restoreChromeMock,
  setTestDocument,
  setTestWindow,
} from './manhuagui-test-setup';

function buildSeriesDocument() {
  const detailSpans = [
    { textContent: '2024', querySelectorAll: () => [] },
    { textContent: '', querySelectorAll: () => [{ textContent: '日本' }] },
    { textContent: '', querySelectorAll: () => [{ textContent: '少年' }] },
    { textContent: '', querySelectorAll: () => [{ textContent: '冒险' }, { textContent: '奇幻' }] },
    { textContent: '', querySelectorAll: () => [{ textContent: '荒木飞吕彦' }] },
    { textContent: '别名', querySelectorAll: () => [] },
    { textContent: '最新', querySelectorAll: () => [] },
    { textContent: '连载中', querySelectorAll: () => [] },
    { textContent: '2026-04-15', querySelectorAll: () => [] },
  ];

  const chapterGroups = [
    {
      groupTitle: '单话',
      links: [
        {
          href: 'https://www.manhuagui.com/comic/28004/760111.html',
          textContent: '第2话 重逢',
        },
        {
          href: 'https://www.manhuagui.com/comic/28004/760110.html',
          textContent: '第1话 启程',
        },
      ],
    },
    {
      groupTitle: '单行本',
      links: [
        {
          href: 'https://www.manhuagui.com/comic/28004/760210.html',
          textContent: '第1卷',
        },
      ],
    },
  ];

  return {
    querySelector: (selector: string) => {
      if (selector === '.book-cont') {
        return {
          querySelector: (nested: string) => {
            if (nested === '.book-title h1') return { textContent: '测试漫画' };
            if (nested === '.book-title h2') return { textContent: 'Test Manga Alias' };

            if (nested === '.hcover img') {
              return {
                getAttribute: (name: string) => (name === 'src' ? '//cf.hamreus.com/covers/test.jpg' : null),
              };
            }

            if (nested === '#intro-all') {
              return {
                textContent: '这是一个系列简介。',
              };
            }

            return null;
          },
        };
      }

      if (selector === '#checkAdult' || selector === '#__VIEWSTATE') {
        return null;
      }

      return null;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '.detail-list span') {
        return detailSpans;
      }

      if (selector === '.chapter h4, .chapter > h4') {
        return chapterGroups.map((group) => ({ textContent: group.groupTitle }));
      }

      if (selector === '.chapter-list') {
        return chapterGroups.map((group, index) => ({
          previousElementSibling: { textContent: group.groupTitle },
          querySelectorAll: (nested: string) => (nested === 'li > a, a' ? group.links : []),
          getAttribute: (name: string) => (name === 'id' ? `chapter-list-${index + 1}` : null),
        }));
      }

      return [];
    },
  };
}

function buildAdultWarningDocument(encodedViewState: string) {
  return {
    querySelector: (selector: string) => {
      if (selector === '#checkAdult') {
        return { textContent: '成人内容提示' };
      }

      if (selector === '#__VIEWSTATE') {
        return {
          getAttribute: (name: string) => (name === 'value' ? encodedViewState : null),
        };
      }

      if (selector === '.book-cont') {
        return null;
      }

      return null;
    },
    querySelectorAll: () => [],
  };
}

const readerConfigScript = `
  pVars={page:1,curServ:0,priServ:3,curHost:3,curFunc:0,curFile:"",manga:{preLoadNumber:1}};
  SMH.picserv=function(){var t=[{name:"自动",hosts:[{h:"i",w:.1},{h:"eu",w:4},{h:"eu1",w:4},{h:"eu2",w:4},{h:"us",w:1},{h:"us1",w:1},{h:"us2",w:1},{h:"us3",w:1}]},{name:"电信",hosts:[{h:"eu",w:1},{h:"eu1",w:1},{h:"eu2",w:1}]},{name:"联通",hosts:[{h:"us",w:1},{h:"us1",w:1},{h:"us2",w:1},{h:"us3",w:1}]}],n=[],i=[],r=0;return{}}();
`;

function buildPackedChapterHtml(rawKeys: string, path = '/ps4/z/zhoushuhz_jjx/第01回/') {
  return `
    <script src="//cf.mhgui.com/scripts/config_TEST.js"></script>
    <script>
      window["eval"](function(p,a,c,k,e,d){return p;}('SMH.imgData({"files":["001.jpg.webp","002.jpg.webp"],"path":"${path}","sl":{"e":1712345678,"m":"abc123"}}).preInit();',62,0,'${rawKeys}'['split']('|'),0,{}))
    </script>
  `;
}

export function registerManhuaguiCases(): void {
  describe('Manhuagui integration', () => {
    it('extracts series id from /comic/{id}/ pages', async () => {
      const snapshot = captureBrowserGlobals();
      setTestWindow({ location: { pathname: '/comic/28004/' } });

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      expect(manhuaguiIntegration.content.series.getSeriesId()).toBe('28004');

      restoreBrowserGlobals(snapshot);
    });

    it('extracts metadata from the series page structure', async () => {
      const snapshot = captureBrowserGlobals();
      setTestWindow({ location: { pathname: '/comic/28004/', origin: 'https://www.manhuagui.com' } });
      setTestDocument(buildSeriesDocument());

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      const extractSeriesMetadata = manhuaguiIntegration.content.series.extractSeriesMetadata;
      expect(extractSeriesMetadata).toBeDefined();
      if (!extractSeriesMetadata) {
        throw new Error('Expected extractSeriesMetadata to be defined');
      }

      const metadata = extractSeriesMetadata();
      expect(metadata).toMatchObject({
        title: '测试漫画',
        author: '荒木飞吕彦',
        description: '这是一个系列简介。',
        coverUrl: 'https://cf.hamreus.com/covers/test.jpg',
        alternativeTitles: ['Test Manga Alias'],
        status: '连载中',
        year: 2024,
        genres: ['冒险', '奇幻'],
        language: 'zh',
        readingDirection: 'rtl',
      });

      restoreBrowserGlobals(snapshot);
    });

    it('extracts grouped chapter lists from the series DOM', async () => {
      const snapshot = captureBrowserGlobals();
      setTestWindow({ location: { pathname: '/comic/28004/', origin: 'https://www.manhuagui.com' } });
      setTestDocument(buildSeriesDocument());

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      const extractChapterList = manhuaguiIntegration.content.series.extractChapterList;
      expect(extractChapterList).toBeDefined();
      if (!extractChapterList) {
        throw new Error('Expected extractChapterList to be defined');
      }

      const chapterResult = await extractChapterList();
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(3);
      expect(chapters.map(chapter => chapter.id)).toEqual(['760110', '760111', '760210']);
      expect(chapters[0]).toMatchObject({
        title: '第1话 启程',
        chapterNumber: 1,
        volumeLabel: '单话',
        url: 'https://www.manhuagui.com/comic/28004/760110.html',
      });
      expect(chapters[2]).toMatchObject({
        title: '第1卷',
        chapterNumber: 1,
        volumeLabel: '单行本',
      });

      restoreBrowserGlobals(snapshot);
    });

    it('decodes adult chapter lists from __VIEWSTATE content when the warning page is shown', async () => {
      const snapshot = captureBrowserGlobals();
      const adultChapterMarkup = `
        <h4>限制级</h4>
        <div class="chapter-list" id="chapter-list-1">
          <ul>
            <li><a href="/comic/21243/900001.html">第1话 夜幕</a></li>
            <li><a href="/comic/21243/900002.html">第2话 余烬</a></li>
          </ul>
        </div>
      `;

      class MockDomParser {
        parseFromString(_html: string) {
          return {
            querySelector: () => null,
            querySelectorAll: (selector: string) => {
              if (selector === '.chapter-list') {
                return [{
                  previousElementSibling: { textContent: '限制级' },
                  parentElement: null,
                  querySelectorAll: (nested: string) => (
                    nested === 'li > a, a'
                      ? [
                        { href: 'https://www.manhuagui.com/comic/21243/900001.html', textContent: '第1话 夜幕' },
                        { href: 'https://www.manhuagui.com/comic/21243/900002.html', textContent: '第2话 余烬' },
                      ]
                      : []
                  ),
                }];
              }

              return [];
            },
          };
        }
      }

      setTestWindow({ location: { pathname: '/comic/21243/', origin: 'https://www.manhuagui.com' } });
      setTestDocument(buildAdultWarningDocument(compressToBase64(adultChapterMarkup)));
      Object.defineProperty(globalThis, 'DOMParser', {
        value: MockDomParser,
        configurable: true,
      });

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      const extractChapterList = manhuaguiIntegration.content.series.extractChapterList;
      expect(extractChapterList).toBeDefined();
      if (!extractChapterList) {
        throw new Error('Expected extractChapterList to be defined');
      }

      const chapterResult = await extractChapterList();
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(2);
      expect(chapters.map(chapter => chapter.id)).toEqual(['900001', '900002']);
      expect(chapters[0]?.volumeLabel).toBe('限制级');
      expect(chapters[0]?.url).toBe('https://www.manhuagui.com/comic/21243/900001.html');

      restoreBrowserGlobals(snapshot);
    });

    it('parses packed viewer HTML into hamreus image URLs using the site config script', async () => {
      const compressedKeys = compressToBase64('');
      const chapterHtml = buildPackedChapterHtml(compressedKeys);
      mockRateLimitedFetch.mockResolvedValueOnce(makeHtmlResponse(readerConfigScript, 'application/javascript; charset=utf-8'));

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      const urls = await manhuaguiIntegration.background.chapter.parseImageUrlsFromHtml?.({
        chapterId: '760110',
        chapterUrl: 'https://www.manhuagui.com/comic/28004/760110.html',
        chapterHtml,
      });

      expect(urls).toEqual([
        'https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第01回/001.jpg.webp?e=1712345678&m=abc123',
        'https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第01回/002.jpg.webp?e=1712345678&m=abc123',
      ]);
      expect(mockRateLimitedFetch).toHaveBeenCalledWith(
        'https://cf.mhgui.com/scripts/config_TEST.js',
        'chapter',
      );
    });

    it('resolveImageUrls fetches chapter HTML and the config script to reconstruct filePath', async () => {
      const compressedKeys = compressToBase64('');
      mockRateLimitedFetch
        .mockResolvedValueOnce(makeHtmlResponse(buildPackedChapterHtml(compressedKeys, '/ps4/z/zhoushuhz_jjx/第02回/')))
        .mockResolvedValueOnce(makeHtmlResponse(readerConfigScript, 'application/javascript; charset=utf-8'));

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      const urls = await manhuaguiIntegration.background.chapter.resolveImageUrls?.({
        id: '760111',
        url: 'https://www.manhuagui.com/comic/28004/760111.html',
      });

      expect(urls).toEqual([
        'https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第02回/001.jpg.webp?e=1712345678&m=abc123',
        'https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第02回/002.jpg.webp?e=1712345678&m=abc123',
      ]);
      expect(mockRateLimitedFetch).toHaveBeenNthCalledWith(
        1,
        'https://www.manhuagui.com/comic/28004/760111.html',
        'chapter',
      );
      expect(mockRateLimitedFetch).toHaveBeenNthCalledWith(
        2,
        'https://cf.mhgui.com/scripts/config_TEST.js',
        'chapter',
      );
    });

    it('downloads hamreus images with the Manhuagui referrer contract', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'image/webp' : null) },
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      });

      const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
      const result = await manhuaguiIntegration.background.chapter.downloadImage(
        'https://us.hamreus.com/ps4/g/h/i/003.jpg?e=1712345679&m=def456',
      );

      expect(result).toMatchObject({
        filename: '003.jpg',
        mimeType: 'image/webp',
      });
      expect(result.data.byteLength).toBe(4);

      const [requestUrl, scope, requestInit] = mockRateLimitedFetch.mock.calls[0] as [string, string, RequestInit];
      expect(requestUrl).toBe('https://us.hamreus.com/ps4/g/h/i/003.jpg?e=1712345679&m=def456');
      expect(scope).toBe('image');
      expect(requestInit.referrer).toBe('https://www.manhuagui.com/');
      expect(requestInit.referrerPolicy).toBe('strict-origin-when-cross-origin');
      expect(requestInit.headers).toEqual({
        referer: 'https://www.manhuagui.com/',
      });
    });

    describe('adult-gate cookie priming', () => {
      it('prepareDispatchContext sets the isAdult cookie on .manhuagui.com', async () => {
        const cookieSet = vi.fn().mockResolvedValue({});
        const snapshot = installChromeMock({ cookies: { set: cookieSet } });

        try {
          const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
          const dispatchContext = await manhuaguiIntegration.background.prepareDispatchContext?.({
            taskId: 'task-1',
            seriesKey: 'manhuagui#28004',
            chapter: { id: '760110', url: 'https://www.manhuagui.com/comic/28004/760110.html', title: '第1话 启程', comicInfo: {} },
            settingsSnapshot: {} as never,
          });

          expect(dispatchContext).toBeUndefined();
          expect(cookieSet).toHaveBeenCalledTimes(1);
          const [cookiePayload] = cookieSet.mock.calls[0] as [chrome.cookies.SetDetails];
          expect(cookiePayload).toMatchObject({
            url: 'https://www.manhuagui.com',
            name: 'isAdult',
            value: '1',
            domain: '.manhuagui.com',
            path: '/',
          });
          expect(typeof cookiePayload.expirationDate).toBe('number');
          const secondsFromNow = (cookiePayload.expirationDate ?? 0) - Math.floor(Date.now() / 1000);
          expect(secondsFromNow).toBeGreaterThan(60 * 60 * 24 * 360);
          expect(secondsFromNow).toBeLessThan(60 * 60 * 24 * 370);
        } finally {
          restoreChromeMock(snapshot);
        }
      });

      it('prepareDispatchContext no-ops gracefully when chrome.cookies is unavailable', async () => {
        const previousChrome = (globalThis as { chrome?: unknown }).chrome;
        (globalThis as { chrome?: unknown }).chrome = {} as unknown as typeof chrome;

        try {
          const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
          await expect(
            manhuaguiIntegration.background.prepareDispatchContext?.({
              taskId: 'task-1',
              seriesKey: 'manhuagui#28004',
              chapter: { id: '760110', url: 'https://www.manhuagui.com/comic/28004/760110.html', title: '第1话 启程', comicInfo: {} },
              settingsSnapshot: {} as never,
            }),
          ).resolves.toBeUndefined();
        } finally {
          (globalThis as { chrome?: unknown }).chrome = previousChrome;
        }
      });

      it('prepareDispatchContext swallows chrome.cookies.set rejections', async () => {
        const cookieSet = vi.fn().mockRejectedValue(new Error('quota exceeded'));
        const snapshot = installChromeMock({ cookies: { set: cookieSet } });

        try {
          const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
          await expect(
            manhuaguiIntegration.background.prepareDispatchContext?.({
              taskId: 'task-1',
              seriesKey: 'manhuagui#28004',
              chapter: { id: '760110', url: 'https://www.manhuagui.com/comic/28004/760110.html', title: '第1话 启程', comicInfo: {} },
              settingsSnapshot: {} as never,
            }),
          ).resolves.toBeUndefined();
          expect(cookieSet).toHaveBeenCalledTimes(1);
        } finally {
          restoreChromeMock(snapshot);
        }
      });

      it('parseImageUrlsFromHtml raises an actionable age-gate error when the cookie was not honored', async () => {
        const ageGateHtml = `
          <html>
            <body>
              <div id="checkAdult" class="w980 mt10">
                <p>本漫画为成年读者向，请确认您年满18周岁后再继续访问。</p>
                <a href="javascript:showAdultInfo();" onclick="showAdultInfo();">成年读者，请点击此处进入</a>
              </div>
            </body>
          </html>
        `;

        const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
        const parseImageUrlsFromHtml = manhuaguiIntegration.background.chapter.parseImageUrlsFromHtml;
        expect(parseImageUrlsFromHtml).toBeDefined();
        if (!parseImageUrlsFromHtml) {
          throw new Error('Expected parseImageUrlsFromHtml to be defined');
        }

        await expect(
          parseImageUrlsFromHtml({
            chapterId: '760110',
            chapterUrl: 'https://www.manhuagui.com/comic/28004/760110.html',
            chapterHtml: ageGateHtml,
          }),
        ).rejects.toThrow(/age-gate not bypassed/);
      });

      it('resolveImageUrls proactively primes the adult cookie before fetching the chapter', async () => {
        const cookieSet = vi.fn().mockResolvedValue({});
        const snapshot = installChromeMock({ cookies: { set: cookieSet } });

        try {
          const { manhuaguiIntegration } = await import('@/src/site-integrations/manhuagui');
          await manhuaguiIntegration.background.prepareDispatchContext?.({
            taskId: 'task-1',
            seriesKey: 'manhuagui#28004',
            chapter: { id: '760110', url: 'https://www.manhuagui.com/comic/28004/760110.html', title: '第1话 启程', comicInfo: {} },
            settingsSnapshot: {} as never,
          });

          expect(cookieSet).toHaveBeenCalledWith(
            expect.objectContaining({
              url: 'https://www.manhuagui.com',
              name: 'isAdult',
              value: '1',
              domain: '.manhuagui.com',
            }),
          );
        } finally {
          restoreChromeMock(snapshot);
        }
      });
    });
  });
}
