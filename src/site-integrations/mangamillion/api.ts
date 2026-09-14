import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { decodeMangaMillionResponse } from "./proto"
import type {
  MangaMillionChapterList,
  MangaMillionTitleDetail,
  MangaMillionViewer,
} from "./contracts/api"
import { MANGAMILLION_API_ORIGIN } from "./urls"

let cachedDeviceToken: string | null = null
type DeviceTokenRegistration = {
  controller: AbortController
  promise: Promise<string>
  waiters: Set<symbol>
}

let inFlightTokenRegistration: DeviceTokenRegistration | null = null

function cancelResponseBody(response: Response, reason: unknown): void {
  try {
    void response.body?.cancel(reason).catch(() => undefined)
  } catch {
    // Preserve the provider error; body cancellation is best effort.
  }
}

function getAbortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError")
}

function abandonDeviceTokenRegistration(
  registration: DeviceTokenRegistration,
  reason: unknown
): void {
  if (inFlightTokenRegistration !== registration) return
  inFlightTokenRegistration = null
  registration.controller.abort(reason)
}

function createDeviceTokenRegistration(
  rateLimitService: RateLimitService
): DeviceTokenRegistration {
  const controller = new AbortController()
  const waiters = new Set<symbol>()
  let rejectAbandoned!: (reason?: unknown) => void
  const abortedPromise = new Promise<never>((_, reject) => {
    rejectAbandoned = reject
  })
  const timeoutId = setTimeout(() => {
    const error = new Error("MangaMillion device registration timed out.")
    controller.abort(error)
  }, DEFAULT_FETCH_TIMEOUT_MS)

  const onAbort = () => {
    rejectAbandoned(getAbortReason(controller.signal))
  }
  controller.signal.addEventListener("abort", onAbort, { once: true })

  const perform = async (): Promise<string> => {
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
        signal: controller.signal,
      },
    })

    if (!response.ok) {
      cancelResponseBody(
        response,
        `MangaMillion registration HTTP ${response.status}`
      )
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

    return token
  }

  const operation = Promise.race([perform(), abortedPromise])
  const registration: DeviceTokenRegistration = {
    controller,
    promise: operation
      .then((token) => {
        if (
          inFlightTokenRegistration === registration &&
          !controller.signal.aborted
        ) {
          cachedDeviceToken = token
        }
        return token
      })
      .finally(() => {
        clearTimeout(timeoutId)
        controller.signal.removeEventListener("abort", onAbort)
        if (inFlightTokenRegistration === registration) {
          inFlightTokenRegistration = null
        }
      }),
    waiters,
  }
  return registration
}

function waitForDeviceToken(
  registration: DeviceTokenRegistration,
  signal: AbortSignal | undefined
): Promise<string> {
  if (signal?.aborted) return Promise.reject(getAbortReason(signal))

  const waiter = Symbol("mangamillion-device-token-waiter")
  registration.waiters.add(waiter)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort)
      registration.waiters.delete(waiter)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      if (registration.waiters.size === 0) {
        abandonDeviceTokenRegistration(registration, getAbortReason(signal))
      }
      reject(getAbortReason(signal))
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    void registration.promise.then(
      (token) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(token)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(
          error instanceof Error
            ? error
            : new Error("MangaMillion device registration failed.", {
                cause: error,
              })
        )
      }
    )
  })
}

export async function getDeviceToken(
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw getAbortReason(signal)
  }
  if (cachedDeviceToken) {
    return cachedDeviceToken
  }

  let registration = inFlightTokenRegistration
  if (!registration) {
    registration = createDeviceTokenRegistration(rateLimitService)
    inFlightTokenRegistration = registration
  }

  return waitForDeviceToken(registration, signal)
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
    cancelResponseBody(response, `MangaMillion API ${path} token refresh`)
    if (cachedDeviceToken === token) {
      cachedDeviceToken = null
    }
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
      cancelResponseBody(
        retryResponse,
        `MangaMillion API ${path} retry HTTP ${retryResponse.status}`
      )
      throw new ProviderContractError(
        `MangaMillion API ${path} failed with HTTP ${retryResponse.status} after re-registration.`
      )
    }

    return retryResponse.arrayBuffer()
  }

  if (!response.ok) {
    cancelResponseBody(
      response,
      `MangaMillion API ${path} HTTP ${response.status}`
    )
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
