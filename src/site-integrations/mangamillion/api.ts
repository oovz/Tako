import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import {
  decodeMangaMillionResponse,
  type MangaMillionChapterList,
  type MangaMillionTitleDetail,
  type MangaMillionViewer,
} from "./proto"
import { MANGAMILLION_API_ORIGIN } from "./urls"

let cachedDeviceToken: string | null = null
let inFlightTokenPromise: Promise<string> | null = null

export function setCachedDeviceTokenForTesting(token: string | null): void {
  cachedDeviceToken = token
  inFlightTokenPromise = null
}

export async function getDeviceToken(
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<string> {
  if (cachedDeviceToken) {
    return cachedDeviceToken
  }
  if (inFlightTokenPromise) {
    return inFlightTokenPromise
  }

  inFlightTokenPromise = (async () => {
    try {
      const registerUrl = `${MANGAMILLION_API_ORIGIN}/api/register`
      const response = await integrationHttpClient.request({
        integrationId: "mangamillion",
        endpointId: "mangamillion-api",
        url: registerUrl,
        scope: "chapter",
        rateLimitService,
        init: {
          method: "POST",
          credentials: "omit",
          signal,
        },
      })

      if (!response.ok) {
        throw new ProviderContractError(
          `MangaMillion device registration failed with HTTP ${response.status}.`
        )
      }

      const buffer = await response.arrayBuffer()
      const decoded = decodeMangaMillionResponse(buffer)

      if (decoded.status !== 0) {
        throw new ProviderContractError(
          `MangaMillion device registration failed: ${decoded.errorMessage || `status ${decoded.status}`}`
        )
      }

      const token = decoded.deviceTokenRegister?.token
      if (!token) {
        throw new ProviderContractError(
          "MangaMillion device registration did not return a valid token."
        )
      }

      cachedDeviceToken = token
      return token
    } finally {
      inFlightTokenPromise = null
    }
  })()

  return inFlightTokenPromise
}

async function requestMangaMillionApi(
  path: string,
  parameters: Record<string, string>,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const token = await getDeviceToken(rateLimitService, signal)
  const searchParams = new URLSearchParams(parameters)
  const url = `${MANGAMILLION_API_ORIGIN}${path}?${searchParams.toString()}`

  const response = await integrationHttpClient.request({
    integrationId: "mangamillion",
    endpointId: "mangamillion-api",
    url,
    scope: "chapter",
    rateLimitService,
    init: {
      method: "GET",
      headers: {
        "Access-Token": token,
      },
      credentials: "omit",
      signal,
    },
  })

  if (response.status === 401 || response.status === 422) {
    // Token might be invalid or expired; try re-registering once
    cachedDeviceToken = null
    inFlightTokenPromise = null
    const freshToken = await getDeviceToken(rateLimitService, signal)
    const retryResponse = await integrationHttpClient.request({
      integrationId: "mangamillion",
      endpointId: "mangamillion-api",
      url,
      scope: "chapter",
      rateLimitService,
      init: {
        method: "GET",
        headers: {
          "Access-Token": freshToken,
        },
        credentials: "omit",
        signal,
      },
    })

    if (!retryResponse.ok) {
      throw new ProviderContractError(
        `MangaMillion API ${path} failed with HTTP ${retryResponse.status} after re-registration.`
      )
    }

    return retryResponse.arrayBuffer()
  }

  if (!response.ok) {
    throw new ProviderContractError(
      `MangaMillion API ${path} failed with HTTP ${response.status}.`
    )
  }

  return response.arrayBuffer()
}

export async function fetchTitleDetail(
  titleId: number,
  language: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<MangaMillionTitleDetail> {
  const buffer = await requestMangaMillionApi(
    "/api/title_detail",
    {
      original_title_id: String(titleId),
      service_language: language,
      avif_enable: "false",
    },
    rateLimitService,
    signal
  )

  const decoded = decodeMangaMillionResponse(buffer)
  if (decoded.status !== 0) {
    throw new ProviderContractError(
      `MangaMillion title detail error: ${decoded.errorMessage || `status ${decoded.status}`}`
    )
  }

  if (!decoded.titleDetail) {
    throw new ProviderContractError(
      `MangaMillion title ${titleId} detail not found in response.`
    )
  }

  return decoded.titleDetail
}

export async function fetchChapterList(
  titleId: number,
  language: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<MangaMillionChapterList> {
  const buffer = await requestMangaMillionApi(
    "/api/chapter_list",
    {
      original_title_id: String(titleId),
      translated_language: language,
      service_language: language,
      avif_enable: "false",
    },
    rateLimitService,
    signal
  )

  const decoded = decodeMangaMillionResponse(buffer)
  if (decoded.status !== 0) {
    throw new ProviderContractError(
      `MangaMillion chapter list error: ${decoded.errorMessage || `status ${decoded.status}`}`
    )
  }

  if (!decoded.chapterList) {
    throw new ProviderContractError(
      `MangaMillion chapter list for title ${titleId} not found in response.`
    )
  }

  return decoded.chapterList
}

export async function fetchViewer(
  chapterId: number,
  language: string,
  quality: "middle" | "low" = "middle",
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<MangaMillionViewer> {
  const buffer = await requestMangaMillionApi(
    "/api/viewer",
    {
      translated_chapter_id: String(chapterId),
      quality,
      service_language: language,
      avif_enable: "false",
    },
    rateLimitService,
    signal
  )

  const decoded = decodeMangaMillionResponse(buffer)
  if (decoded.status !== 0) {
    throw new ProviderContractError(
      `MangaMillion viewer error: ${decoded.errorMessage || `status ${decoded.status}`}`
    )
  }

  if (!decoded.viewer) {
    throw new ProviderContractError(
      `MangaMillion viewer data for chapter ${chapterId} not found in response.`
    )
  }

  return decoded.viewer
}
