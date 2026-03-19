// Configuration for live metadata testing
// Add new test cases here by extending the testCases array

import type { ComicInfoV2 } from "@/src/types/comic-info";
import {
  LIVE_MANGADEX_REFERENCE_URL,
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_SHONENJUMPPLUS_REFERENCE_URL,
} from '../e2e/fixtures/test-domains';

export interface LiveTestCase {
  url: string;
  expectedMetadata: ComicInfoV2
  integration: string; // site integration ID that should handle this URL
}

const LIVE_REFERENCE_URLS = {
  mangadex: LIVE_MANGADEX_REFERENCE_URL,
  pixivComic: LIVE_PIXIV_COMIC_REFERENCE_URL,
  shonenjumpplus: LIVE_SHONENJUMPPLUS_REFERENCE_URL,
} as const;

export const testCases: LiveTestCase[] = [
  {
    url: LIVE_REFERENCE_URLS.mangadex,
    integration: 'mangadex',
    expectedMetadata: {
      Series: 'Kemutai Hanashi',
    }
  },
  {
    url: LIVE_REFERENCE_URLS.pixivComic,
    integration: 'pixiv-comic',
    expectedMetadata: {
      Series: '煙たい話',
    }
  },
  {
    url: LIVE_REFERENCE_URLS.shonenjumpplus,
    integration: 'shonenjumpplus',
    expectedMetadata: {
      Series: 'エクソシストを堕とせない',
    }
  },
];
