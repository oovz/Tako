import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildComicNettaiViewerApiUrl,
  extractComicNettaiBookContentId,
  parseComicNettaiSeriesIdFromPath,
  parseComicNettaiViewerCid,
} from '@/src/site-integrations/comicnettai/shared'
import {
  buildPublusImageUrlsFromConfig,
  downloadComicNettaiChapterImage,
  processComicNettaiImageUrls,
  resolveComicNettaiChapterImageUrls,
} from '@/src/site-integrations/comicnettai/chapter-api'
import {
  buildPublusPageTileRects,
  parsePublusImageTransportUrl,
} from '@/src/site-integrations/comicnettai/publus-image'

const LIVE_PUBLUS_KEYS = {
  key1: '77fb2c670460a4daeb0463c40976806a63750720ceb768cf43031fca8f3eb5e2',
  key2: '49840499d31b5b7bffadf76a48b1308b25f6c2ed154d91f66abc7764ec9029d2',
  key3: 'f7cccf3b883fb488f842ec6afc7129a5ded56bd98143c6bfd6951a958f2843e1',
} as const

const LIVE_PUBLUS_CONFIG = {
  configuration: {
    'file-name-version': '1.0',
    keys: LIVE_PUBLUS_KEYS,
    contents: [
      {
        file: 'item/xhtml/p-cover.xhtml',
        index: 1,
        'original-file-path': 'item/xhtml/p-cover.xhtml',
        type: 'jpeg',
      },
      {
        file: 'item/xhtml/p-000.xhtml',
        index: 2,
        'original-file-path': 'item/xhtml/p-000.xhtml',
        type: 'jpeg',
      },
      {
        file: 'item/xhtml/p-001.xhtml',
        index: 3,
        'original-file-path': 'item/xhtml/p-001.xhtml',
        type: 'jpeg',
      },
    ],
  },
  'item/xhtml/p-cover.xhtml': {
    FileLinkInfo: {
      PageLinkInfoList: [{
        Page: {
          No: 0,
          NS: 492551829,
          PS: 1062163659,
          RS: 1425211224,
          BlockWidth: 32,
          BlockHeight: 32,
        },
      }],
    },
  },
  'item/xhtml/p-000.xhtml': {
    FileLinkInfo: {
      PageLinkInfoList: [{
        Page: {
          No: 0,
          NS: 3426648385,
          PS: 2558111233,
          RS: 4130047053,
          BlockWidth: 32,
          BlockHeight: 32,
        },
      }],
    },
  },
  'item/xhtml/p-001.xhtml': {
    FileLinkInfo: {
      PageLinkInfoList: [{
        Page: {
          No: 0,
          NS: 3964085832,
          PS: 2712502983,
          RS: 3995491631,
          BlockWidth: 32,
          BlockHeight: 32,
        },
      }],
    },
  },
} as const

describe('Comic Nettai site integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts the series id from /book/{id} URLs only', () => {
    expect(parseComicNettaiSeriesIdFromPath('/book/9')).toBe('9')
    expect(parseComicNettaiSeriesIdFromPath('/book/9/')).toBe('9')
    expect(parseComicNettaiSeriesIdFromPath('/publus/viewer.html')).toBeNull()
    expect(parseComicNettaiSeriesIdFromPath('/book/not-numeric')).toBeNull()
  })

  it('uses the book content thumbnail directory as the stable chapter id', () => {
    expect(
      extractComicNettaiBookContentId(
        'https://cdn.comicnettai.com/9_hash/book_contents/958/icon_chap46.jpg',
      ),
    ).toBe('958')
    expect(extractComicNettaiBookContentId('https://cdn.comicnettai.com/cover.jpg')).toBeNull()
  })

  it('extracts viewer cids and builds the official viewer content-check API URL', () => {
    const chapterUrl = 'https://www.comicnettai.com/publus/viewer.html?cid=mock-cid'

    expect(parseComicNettaiViewerCid(chapterUrl)).toBe('mock-cid')
    expect(buildComicNettaiViewerApiUrl(chapterUrl)).toBe(
      'https://www.comicnettai.com/api/viewer/c?cid=mock-cid',
    )
  })

  it('derives PUBLUS image URLs from decoded configuration data', () => {
    const urls = buildPublusImageUrlsFromConfig(
      'https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/',
      LIVE_PUBLUS_CONFIG,
    )

    expect(urls.map((url) => parsePublusImageTransportUrl(url).sourceUrl)).toEqual([
      'https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/item/xhtml/p-cover.xhtml/106858d4a8cf8d2165.jpeg',
      'https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/item/xhtml/p-000.xhtml/1016cec4222ae82a25.jpeg',
      'https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/item/xhtml/p-001.xhtml/1039055a13d52f0869.jpeg',
    ])
    expect(parsePublusImageTransportUrl(urls[0]!).metadata).toMatchObject({
      mode: 372,
      seed1: 2734906895,
      seed2: 3927281451,
      seed3: 1733819256,
      tileWidth: 32,
      tileHeight: 32,
    })
  })

  it('builds the same PUBLUS tile rectangles as the official Comic Nettai viewer', () => {
    const rects = buildPublusPageTileRects({
      sourceWidth: 920,
      sourceHeight: 1304,
      mode: 372,
      seed1: 2734906895,
      seed2: 3927281451,
      seed3: 1733819256,
      tileWidth: 32,
      tileHeight: 32,
    })

    expect(rects).toHaveLength(1189)
    expect(rects.slice(0, 8)).toEqual([
      { srcX: 0, srcY: 0, destX: 32, destY: 856, width: 32, height: 32 },
      { srcX: 0, srcY: 32, destX: 824, destY: 568, width: 32, height: 32 },
      { srcX: 0, srcY: 64, destX: 760, destY: 440, width: 32, height: 32 },
      { srcX: 0, srcY: 96, destX: 824, destY: 160, width: 32, height: 32 },
      { srcX: 0, srcY: 128, destX: 64, destY: 288, width: 32, height: 32 },
      { srcX: 0, srcY: 160, destX: 440, destY: 32, width: 32, height: 32 },
      { srcX: 0, srcY: 192, destX: 512, destY: 1176, width: 32, height: 32 },
      { srcX: 0, srcY: 224, destX: 160, destY: 792, width: 32, height: 32 },
    ])
    expect(rects.slice(-8)).toEqual([
      { srcX: 512, srcY: 1024, destX: 320, destY: 960, width: 24, height: 32 },
      { srcX: 512, srcY: 1056, destX: 192, destY: 160, width: 24, height: 32 },
      { srcX: 320, srcY: 1112, destX: 288, destY: 1144, width: 24, height: 32 },
      { srcX: 544, srcY: 1144, destX: 128, destY: 1272, width: 24, height: 32 },
      { srcX: 416, srcY: 1176, destX: 352, destY: 576, width: 24, height: 32 },
      { srcX: 64, srcY: 1208, destX: 288, destY: 608, width: 24, height: 32 },
      { srcX: 512, srcY: 1240, destX: 288, destY: 1016, width: 24, height: 32 },
      { srcX: 224, srcY: 1272, destX: 160, destY: 256, width: 24, height: 32 },
    ])
  })

  it('fetches viewer metadata and configuration_pack.json to resolve image URLs', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://www.comicnettai.com/api/viewer/c?cid=mock-cid') {
        return new Response(JSON.stringify({
          status: '200',
          url: 'https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/',
          cti: '第46話',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url === 'https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/configuration_pack.json') {
        return new Response(JSON.stringify(LIVE_PUBLUS_CONFIG), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      resolveComicNettaiChapterImageUrls({
        id: '958',
        url: 'https://www.comicnettai.com/publus/viewer.html?cid=mock-cid',
      }),
    ).resolves.toHaveLength(3)
  })

  it('filters invalid image candidates and downloads raster images', async () => {
    await expect(processComicNettaiImageUrls([
      'https://cdn.comicnettai.com/page.jpeg',
      'not-a-url',
    ])).resolves.toEqual(['https://cdn.comicnettai.com/page.jpeg'])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4E, 0x47]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })))

    await expect(
      downloadComicNettaiChapterImage('https://cdn.comicnettai.com/page.png'),
    ).resolves.toMatchObject({
      filename: 'page.png',
      mimeType: 'image/png',
    })
  })
})
