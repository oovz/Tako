import { sanitizeLabel } from '@/src/shared/site-integration-utils'

export const PIXIV_BASE_URL = 'https://comic.pixiv.net'
export const PIXIV_EPISODES_API_URL = `${PIXIV_BASE_URL}/api/app/episodes`
export const PIXIV_IMAGE_REFERRER = `${PIXIV_BASE_URL}/`
export const PIXIV_KEY_FRAGMENT_PARAM = 'tmdPixivKey'
export const PIXIV_GRIDSHUFFLE_HEADER = 'x-cobalt-thumber-parameter-gridshuffle-key'

export const pixivBuildIdCacheByTask = new Map<string, string>()

export type PixivResolveContext = {
  taskId?: string
  cookieHeader?: string
}

export type PixivReadV4Page = {
  src?: string
  url?: string
  image_url?: string
  key?: string
}

export type PixivWorkV5Response = {
  data?: {
    official_work?: {
      id?: number
      name?: string
      author?: string
      description?: string
      image?: {
        main?: string
        main_big?: string
        thumbnail?: string
      }
    }
  }
}

export type PixivOfficialWork = NonNullable<NonNullable<PixivWorkV5Response['data']>['official_work']>

export type PixivEpisodesV2Response = {
  data?: {
    episodes?: Array<{
      state?: string
      episode?: {
        id?: number
        numbering_title?: string
        sub_title?: string
        read_start_at?: number
        viewer_path?: string
        sales_type?: string
        state?: string
      }
    }>
  }
}

export type PixivEpisodeEntry = NonNullable<NonNullable<PixivEpisodesV2Response['data']>['episodes']>[number]

export const resolvePixivCookieHeader = (context?: Record<string, unknown>): string | undefined => {
  const cookieHeader = context?.cookieHeader
  if (typeof cookieHeader !== 'string') {
    return undefined
  }

  const normalized = cookieHeader.trim()
  return normalized.length > 0 ? normalized : undefined
}

export const createPixivAppHeaders = (): Record<string, string> => ({
  'x-requested-with': 'pixivcomic',
  'x-referer': PIXIV_BASE_URL,
})

export const sanitizePixivHtmlText = (value: string | undefined): string | undefined => {
  const normalized = sanitizeLabel(
    (value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
  return normalized || undefined
}
