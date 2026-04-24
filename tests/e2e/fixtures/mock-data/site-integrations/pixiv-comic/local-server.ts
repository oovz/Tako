/**
 * @file local-server.ts
 * @description Local-mock-server handlers + DNR redirect rules for the
 * Pixiv Comic integration.
 *
 * Pixiv Comic's download pipeline calls these external hosts from
 * extension contexts (background SW + offscreen):
 *
 *   1. `comic.pixiv.net/` — Next.js homepage HTML. `chapter-api.ts`
 *      fetches it to parse the build id via
 *      `/_next/static/{buildId}/_buildManifest.js`.
 *   2. `comic.pixiv.net/_next/data/{buildId}/viewer/stories/{storyId}.json`
 *      — chapter "salt" + pages manifest.
 *   3. `comic.pixiv.net/api/app/works/v5/{workId}` — series metadata.
 *   4. `comic.pixiv.net/api/app/works/{workId}/episodes/v2` — chapter
 *      feed.
 *   5. `comic.pixiv.net/api/app/episodes/{storyId}/read_v4` — image
 *      URL list.
 *   6. `img-comic.pximg.net/...` — image CDN.
 *
 * DNR rules below redirect 1–5 into `__pc/site` and 6 into `__pc/img`.
 * Main-frame navigations to `comic.pixiv.net/works/{id}` are excluded
 * (DNR leaves `main_frame` alone) and continue to be served by the
 * Playwright route registrar in `./routes.ts`.
 */

import type { DnrRedirectRule } from '../../../dnr-test-redirects';
import type { LocalMockServerHandle, MockRouteHandler, MockRouteResponse } from '../../../local-mock-server';
import { cloneSmallPngBytes, SMALL_PNG_MIME_TYPE } from '../../shared';
import {
  buildPixivEpisodesV2Response,
  buildPixivWorkV5Response,
} from './api-fixtures';
import { BASIC_CHAPTERS, SMALL_SERIES } from './chapter-data';
import { BASIC_SERIES, MINIMAL_SERIES } from './series-data';

export const PIXIV_COMIC_LOCAL_SITE_PREFIX = '/__pc/site';
export const PIXIV_COMIC_LOCAL_IMAGE_PREFIX = '/__pc/img';

/** Assigned DNR rule ids within the reserved 9000–9999 test range. */
const PIXIV_COMIC_SITE_RULE_ID = 9300;
const PIXIV_COMIC_IMAGE_RULE_ID = 9301;

/**
 * Deterministic Next.js build id embedded in the mocked homepage HTML.
 * The production `parseBuildId` regex extracts whatever token sits
 * between `/_next/static/` and `/_buildManifest.js`, so as long as the
 * homepage and the `/_next/data/{buildId}/...` handler use the same
 * value the pipeline resolves successfully.
 */
const MOCK_PIXIV_BUILD_ID = 'mockPixivBuildId123';

/**
 * Deterministic per-chapter "salt". Production uses this value to
 * compute an HMAC client hash header the API validates; the mocked
 * `read_v4` handler ignores the header entirely so any non-empty value
 * satisfies `fetchPixivSalt`.
 */
const MOCK_PIXIV_SALT = 'mock-pixiv-salt';

/**
 * Mock chapter image URL. Points at the pximg image host so the DNR
 * redirect for `img-comic.pximg.net` catches it.
 */
function buildMockImageUrl(storyId: string, pageIndex: number): string {
  return `https://img-comic.pximg.net/mock/${storyId}/${pageIndex}.png`;
}

function htmlResponse(body: string): MockRouteResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  };
}

function jsonResponse(body: object): MockRouteResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body,
  };
}

/**
 * Homepage HTML the pipeline fetches to discover the build id. Only
 * the `/_next/static/{buildId}/_buildManifest.js` marker is required;
 * the surrounding markup exists to look like a real Next.js bundle
 * so the HTML decoder handles it as UTF-8.
 */
const HOMEPAGE_WITH_BUILD_ID_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Pixiv Comic</title>
  <link rel="preload" href="/_next/static/${MOCK_PIXIV_BUILD_ID}/_buildManifest.js" as="script">
  <script src="/_next/static/${MOCK_PIXIV_BUILD_ID}/_buildManifest.js" async></script>
</head>
<body>
  <div id="__next"><main>Pixiv Comic Home</main></div>
</body>
</html>`;

/**
 * Resolve a deterministic per-chapter page list for the given story id.
 * Story ids that match the known chapter datasets are mapped to their
 * chapter-number index; unknown ids get a single-page fallback so
 * `resolveImageUrls` always returns at least one URL.
 */
function resolveMockPageCountForStory(storyId: string): number {
  const known = [...BASIC_CHAPTERS.chapters, ...SMALL_SERIES.chapters].find(
    (chapter) => chapter.id === storyId,
  );
  return known ? 1 : 1;
}

/**
 * Build the `pageProps` payload the `_next/data/.../stories/{id}.json`
 * endpoint returns. `salt` is the only required field for the happy
 * path — `reading_episode.pages` is a fallback the client reads when
 * the subsequent `read_v4` call doesn't return its own `pages`.
 */
function buildStorySaltResponse(storyId: string): Record<string, unknown> {
  const pageCount = resolveMockPageCountForStory(storyId);
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    url: buildMockImageUrl(storyId, index + 1),
  }));
  return {
    pageProps: {
      salt: MOCK_PIXIV_SALT,
      story: {
        reading_episode: { pages },
      },
    },
  };
}

/**
 * Build the `read_v4` response — simplest valid shape with a flat
 * `pages` array. No `key` field means the image descrambler is skipped
 * downstream (`downloadPixivChapterImage` only descrambles when a
 * `tmdPixivKey` fragment is present).
 */
function buildReadV4Response(storyId: string): Record<string, unknown> {
  const pageCount = resolveMockPageCountForStory(storyId);
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    url: buildMockImageUrl(storyId, index + 1),
  }));
  return {
    pages,
    reading_episode: { pages },
  };
}

/**
 * Resolve a work id → series id used by the work metadata builders.
 * Falls back to the work id itself if no fixture matches, mirroring
 * the existing Playwright-route behavior.
 */
function resolveWorkIdForMetadata(workId: string): string {
  if (workId === BASIC_SERIES.series.seriesId) return workId;
  if (workId === MINIMAL_SERIES.series.seriesId) return workId;
  return workId;
}

/**
 * comic.pixiv.net handler — dispatches subresource fetches the
 * extension makes into the production API. Main-frame navigations to
 * `/works/{id}` are not redirected here (see module header).
 */
const pixivComicSiteHandler: MockRouteHandler = (req) => {
  const pathname = req.pathnameAfterPrefix;

  // Homepage — must embed `/_next/static/{buildId}/_buildManifest.js`.
  if (pathname === '/' || pathname === '') {
    return htmlResponse(HOMEPAGE_WITH_BUILD_ID_HTML);
  }

  // `/_next/data/{buildId}/viewer/stories/{storyId}.json`
  const saltMatch = pathname.match(
    /^\/_next\/data\/([^/]+)\/viewer\/stories\/(\d+)\.json$/,
  );
  if (saltMatch) {
    const [, , storyId] = saltMatch;
    return jsonResponse(buildStorySaltResponse(storyId));
  }

  // `/api/app/episodes/{storyId}/read_v4`
  const readV4Match = pathname.match(/^\/api\/app\/episodes\/(\d+)\/read_v4$/);
  if (readV4Match) {
    const [, storyId] = readV4Match;
    return jsonResponse(buildReadV4Response(storyId));
  }

  // `/api/app/works/v5/{workId}`
  const workV5Match = pathname.match(/^\/api\/app\/works\/v5\/(\d+)$/);
  if (workV5Match) {
    return jsonResponse(buildPixivWorkV5Response(resolveWorkIdForMetadata(workV5Match[1])));
  }

  // `/api/app/works/{workId}/episodes/v2`
  const episodesV2Match = pathname.match(/^\/api\/app\/works\/(\d+)\/episodes\/v2$/);
  if (episodesV2Match) {
    return jsonResponse(buildPixivEpisodesV2Response(resolveWorkIdForMetadata(episodesV2Match[1])));
  }

  // Any other /api/app/* → 404 JSON so the integration fails fast
  // instead of hanging waiting for a response.
  if (pathname.startsWith('/api/')) {
    return {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { error: 'not_mocked', path: pathname },
    };
  }

  // Everything else returns the homepage placeholder (helps
  // future-proof against miscellaneous non-API fetches).
  return htmlResponse(HOMEPAGE_WITH_BUILD_ID_HTML);
};

/** img-comic.pximg.net handler — returns the shared 1x1 PNG. */
const pixivComicImageHandler: MockRouteHandler = () => ({
  status: 200,
  headers: { 'content-type': SMALL_PNG_MIME_TYPE },
  body: cloneSmallPngBytes(),
});

/**
 * Register the Pixiv Comic handlers on the given local mock server and
 * return the DNR redirect rules.
 */
export function registerPixivComicLocalServerHandlers(
  server: LocalMockServerHandle,
): DnrRedirectRule[] {
  server.addRoute(PIXIV_COMIC_LOCAL_SITE_PREFIX, pixivComicSiteHandler);
  server.addRoute(PIXIV_COMIC_LOCAL_IMAGE_PREFIX, pixivComicImageHandler);

  const base = server.url;
  return [
    {
      id: PIXIV_COMIC_SITE_RULE_ID,
      regexFilter: '^https?://comic\\.pixiv\\.net/(.*)$',
      regexSubstitution: `${base}${PIXIV_COMIC_LOCAL_SITE_PREFIX}/\\1`,
    },
    {
      id: PIXIV_COMIC_IMAGE_RULE_ID,
      regexFilter: '^https?://(?:[a-z0-9-]+\\.)?img-comic\\.pximg\\.net/(.*)$',
      regexSubstitution: `${base}${PIXIV_COMIC_LOCAL_IMAGE_PREFIX}/\\1`,
    },
  ];
}
