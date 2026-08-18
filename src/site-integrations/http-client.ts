import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "@/src/runtime/deterministic-e2e-redirect"
import {
  type EffectivePolicy,
  type RateScope,
  type RateLimitService,
} from "@/src/runtime/rate-limit"
import {
  assertIntegrationEndpointRequestUrl,
  assertIntegrationEndpointResponseUrl,
  getIntegrationEndpointPolicy,
} from "./request-policy"
import type { SiteIntegrationResponseType } from "./definition-types"
import { ResponseBodyLimitError } from "@/src/shared/html-response-decoder"

export type IntegrationHttpRequest = {
  integrationId: string
  endpointId: string
  url: string
  scope: RateScope
  rateLimitService: RateLimitService
  init?: RequestInit
  policyOverride?: EffectivePolicy
  /** Image batches are already scheduled by chapter-image-downloads. */
  skipRateLimit?: boolean
}

function assertInitPolicy(
  init: RequestInit | undefined,
  credentials: RequestCredentials,
  redirect: RequestRedirect
): void {
  if (init?.credentials !== undefined && init.credentials !== credentials) {
    throw new Error(
      `Request credentials mismatch: endpoint requires "${credentials}".`
    )
  }
  if (
    init?.redirect !== undefined &&
    init.redirect !== redirect &&
    !(allowsDeterministicE2eRedirect && init.redirect === "follow")
  ) {
    throw new Error(
      `Request redirect mismatch: endpoint requires "${redirect}".`
    )
  }
}

function assertResponseContentLength(response: Response, maxBytes: number) {
  const value = response.headers?.get?.("content-length")
  if (value === null || value === undefined || value.trim() === "") return
  const contentLength = Number(value)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(
      `Response body exceeds ${maxBytes} byte limit (got ${contentLength})`
    )
  }
}

function assertResponseType(
  response: Response,
  expectedType: SiteIntegrationResponseType
): void {
  if (!response.ok || response.status === 204 || response.status === 205) return

  const contentType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? ""
  const accepted =
    expectedType === "json"
      ? contentType === "application/json" || contentType.endsWith("+json")
      : expectedType === "html"
        ? contentType === "text/html" || contentType === "application/xhtml+xml"
        : expectedType === "text"
          ? contentType.startsWith("text/") ||
            contentType === "application/javascript" ||
            contentType === "application/x-javascript"
          : contentType.startsWith("image/") ||
            contentType === "application/octet-stream" ||
            contentType === "application/protobuf" ||
            contentType === "application/x-protobuf"
  if (!accepted) {
    throw new Error(
      `Response Content-Type ${contentType || "<missing>"} does not match declared ${expectedType} endpoint.`
    )
  }
}

function limitResponseBody(response: Response, maxBytes: number): Response {
  if (!response.body) return response

  let receivedBytes = 0
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength
        if (receivedBytes > maxBytes) {
          controller.error(new ResponseBodyLimitError(maxBytes, receivedBytes))
          return
        }
        controller.enqueue(chunk)
      },
    })
  )
  const limited = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  Object.defineProperties(limited, {
    url: { value: response.url },
    redirected: { value: response.redirected },
    type: { value: response.type },
  })
  return limited
}

export const integrationHttpClient = {
  async request(input: IntegrationHttpRequest): Promise<Response> {
    const endpoint = getIntegrationEndpointPolicy(
      input.integrationId,
      input.endpointId
    )
    assertInitPolicy(input.init, endpoint.credentials, endpoint.redirect)
    const requestUrl = assertIntegrationEndpointRequestUrl(
      input.integrationId,
      input.endpointId,
      input.url
    )
    const init: RequestInit = {
      ...input.init,
      credentials: endpoint.credentials,
      redirect: allowsDeterministicE2eRedirect ? "follow" : endpoint.redirect,
    }

    const perform = async (): Promise<Response> => {
      const response = await fetch(requestUrl.href, init)
      assertResponseContentLength(response, endpoint.maxResponseBytes)
      assertResponseType(response, endpoint.responseType)
      if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
        assertIntegrationEndpointResponseUrl(
          input.integrationId,
          input.endpointId,
          requestUrl.href,
          response.url
        )
      }
      return limitResponseBody(response, endpoint.maxResponseBytes)
    }

    if (input.skipRateLimit) return perform()
    return input.rateLimitService.scheduleForIntegrationScope(
      input.integrationId,
      input.scope,
      perform,
      input.policyOverride
    )
  },
}

/** Shared byte transport for tests and non-provider extension assets. */
export function fetchSharedResource(
  url: string,
  init: RequestInit
): Promise<Response> {
  return fetch(url, init)
}
