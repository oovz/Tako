import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {} as RateLimitService

function encodeVarint(value: number): number[] {
  let remaining = value
  const bytes: number[] = []
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  bytes.push(remaining & 0x7f)
  return bytes
}

function encodeField(
  tag: number,
  wireType: number,
  payload: number[]
): number[] {
  const header = encodeVarint((tag << 3) | wireType)
  if (wireType !== 2) return [...header, ...payload]
  return [...header, ...encodeVarint(payload.length), ...payload]
}

function encodeString(tag: number, value: string): number[] {
  return encodeField(tag, 2, Array.from(new TextEncoder().encode(value)))
}

function encodeInt32(tag: number, value: number): number[] {
  return encodeField(tag, 0, encodeVarint(value))
}

function encodeMessage(tag: number, payload: number[]): number[] {
  return encodeField(tag, 2, payload)
}

function makeTokenResponse(token: string): Response {
  const body = new Uint8Array([
    ...encodeInt32(1, 0),
    ...encodeMessage(170, encodeString(1, token)),
  ])
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer,
  } as unknown as Response
}

function makeTitleResponse(): Response {
  const serviceTitle = [
    ...encodeString(2, "One Piece"),
    ...encodeString(3, "Eiichiro Oda"),
  ]
  const body = new Uint8Array([
    ...encodeInt32(1, 0),
    ...encodeMessage(50, encodeMessage(1, serviceTitle)),
  ])
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer,
  } as unknown as Response
}

function makeStreamStatusResponse(
  status: number,
  onCancel: () => void
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
    },
    cancel() {
      onCancel()
    },
  })
  return new Response(body, { status })
}

function makeStreamBinaryResponse(
  bytes: Uint8Array,
  onCancel: () => void
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
    cancel() {
      onCancel()
    },
  })
  return new Response(body, { status: 200 })
}

function waitForRequestOrAbort(
  input: { init?: RequestInit },
  gate: Promise<void>,
  response: Response
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = input.init?.signal
    const onAbort = () => {
      signal?.removeEventListener("abort", onAbort)
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    void gate.then(
      () => {
        signal?.removeEventListener("abort", onAbort)
        resolve(response)
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

async function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error: unknown) => ({ kind: "rejected" as const, error })
  )
}

async function loadFreshApi() {
  vi.resetModules()
  const [api, httpClient] = await Promise.all([
    import("@/src/site-integrations/mangamillion/api"),
    import("@/src/site-integrations/http-client"),
  ])
  return { api, httpClient: httpClient.integrationHttpClient }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("MangaMillion device registration ownership", () => {
  it("cancels a real registration response stream on HTTP failure", async () => {
    const { api, httpClient } = await loadFreshApi()
    const cancel = vi.fn()
    vi.spyOn(httpClient, "request").mockResolvedValue(
      makeStreamStatusResponse(503, cancel)
    )

    await expect(api.getDeviceToken(rateLimitService)).rejects.toThrow(
      "HTTP 503"
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("cancels an unconsumed non-OK registration response body", async () => {
    const { api, httpClient } = await loadFreshApi()
    const cancel = vi.fn(async () => undefined)
    vi.spyOn(httpClient, "request").mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel },
    } as unknown as Response)

    await expect(api.getDeviceToken(rateLimitService)).rejects.toThrow(
      "HTTP 503"
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([401, 422])(
    "cancels the original %s body and a failed retry body",
    async (status) => {
      const { api, httpClient } = await loadFreshApi()
      const originalCancel = vi.fn(async () => undefined)
      const retryCancel = vi.fn(async () => undefined)
      const request = vi
        .spyOn(httpClient, "request")
        .mockResolvedValueOnce(
          makeStreamBinaryResponse(
            new Uint8Array(await makeTokenResponse("token").arrayBuffer()),
            vi.fn()
          )
        )
        .mockResolvedValueOnce(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([1]))
              },
              cancel() {
                originalCancel()
              },
            }),
            { status }
          )
        )
        .mockResolvedValueOnce(
          makeStreamBinaryResponse(
            new Uint8Array(
              await makeTokenResponse("fresh-token").arrayBuffer()
            ),
            vi.fn()
          )
        )
        .mockResolvedValueOnce(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([1]))
              },
              cancel() {
                retryCancel()
              },
            }),
            { status: 503 }
          )
        )

      await expect(
        api.fetchTitleDetail(1, "en", rateLimitService)
      ).rejects.toThrow("after re-registration")
      expect(request).toHaveBeenCalledTimes(4)
      expect(originalCancel).toHaveBeenCalledOnce()
      expect(retryCancel).toHaveBeenCalledOnce()
    }
  )

  it("cancels a real ordinary 5xx API response body", async () => {
    const { api, httpClient } = await loadFreshApi()
    const registrationCancel = vi.fn()
    const responseCancel = vi.fn()
    const tokenBytes = new Uint8Array(
      await makeTokenResponse("token").arrayBuffer()
    )
    vi.spyOn(httpClient, "request")
      .mockResolvedValueOnce(
        makeStreamBinaryResponse(tokenBytes, registrationCancel)
      )
      .mockResolvedValueOnce(makeStreamStatusResponse(503, responseCancel))

    await expect(
      api.fetchTitleDetail(1, "en", rateLimitService)
    ).rejects.toThrow("HTTP 503")
    expect(registrationCancel).not.toHaveBeenCalled()
    expect(responseCancel).toHaveBeenCalledOnce()
  })

  it("consumes a real successful API response body", async () => {
    const { api, httpClient } = await loadFreshApi()
    const registrationCancel = vi.fn()
    const titleCancel = vi.fn()
    const tokenBytes = new Uint8Array(
      await makeTokenResponse("token").arrayBuffer()
    )
    const titleBytes = new Uint8Array(await makeTitleResponse().arrayBuffer())
    vi.spyOn(httpClient, "request")
      .mockResolvedValueOnce(
        makeStreamBinaryResponse(tokenBytes, registrationCancel)
      )
      .mockResolvedValueOnce(makeStreamBinaryResponse(titleBytes, titleCancel))

    const result = await api.fetchTitleDetail(1, "en", rateLimitService)
    expect(result.serviceTitle?.serviceTitleName).toBe("One Piece")
    expect(registrationCancel).not.toHaveBeenCalled()
    expect(titleCancel).not.toHaveBeenCalled()
  })

  it("coalesces successful registration and caches the decoded token", async () => {
    const { api, httpClient } = await loadFreshApi()
    const gate = Promise.withResolvers<void>()
    const requestSpy = vi
      .spyOn(httpClient, "request")
      .mockImplementation(async () => {
        await gate.promise
        return makeTokenResponse("coalesced-token")
      })

    const first = api.getDeviceToken(rateLimitService)
    const second = api.getDeviceToken(rateLimitService)
    expect(requestSpy).toHaveBeenCalledOnce()

    gate.resolve()
    await expect(first).resolves.toBe("coalesced-token")
    await expect(second).resolves.toBe("coalesced-token")

    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
      "coalesced-token"
    )
    expect(requestSpy).toHaveBeenCalledOnce()
  })

  it("cancels only the first waiter while the shared registration continues", async () => {
    const { api, httpClient } = await loadFreshApi()
    const gate = Promise.withResolvers<void>()
    let registrationSignal: AbortSignal | null | undefined
    const requestSpy = vi
      .spyOn(httpClient, "request")
      .mockImplementation((input) => {
        registrationSignal = input.init?.signal
        return waitForRequestOrAbort(
          input,
          gate.promise,
          makeTokenResponse("second-waiter-token")
        )
      })

    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = api.getDeviceToken(rateLimitService, firstController.signal)
    expect(requestSpy).toHaveBeenCalledOnce()
    const second = api.getDeviceToken(rateLimitService, secondController.signal)

    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: "AbortError" })

    gate.resolve()
    const secondOutcome = await observe(second)
    expect(registrationSignal?.aborted).toBe(false)
    expect(secondOutcome).toEqual({
      kind: "fulfilled",
      value: "second-waiter-token",
    })
  })

  it("cancels only a later waiter while the first caller remains active", async () => {
    const { api, httpClient } = await loadFreshApi()
    const gate = Promise.withResolvers<void>()
    let registrationSignal: AbortSignal | null | undefined
    vi.spyOn(httpClient, "request").mockImplementation((input) => {
      registrationSignal = input.init?.signal
      return waitForRequestOrAbort(
        input,
        gate.promise,
        makeTokenResponse("first-waiter-token")
      )
    })

    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = api.getDeviceToken(rateLimitService, firstController.signal)
    const second = api.getDeviceToken(rateLimitService, secondController.signal)

    secondController.abort()
    gate.resolve()
    const secondOutcome = await observe(second)
    expect(secondOutcome.kind).toBe("rejected")
    if (secondOutcome.kind === "rejected") {
      expect(secondOutcome.error).toMatchObject({ name: "AbortError" })
    }
    expect(registrationSignal?.aborted).toBe(false)

    await expect(first).resolves.toBe("first-waiter-token")
  })

  it("aborts an abandoned registration and prevents its late token from being cached", async () => {
    const { api, httpClient } = await loadFreshApi()
    const oldGate = Promise.withResolvers<void>()
    let requestNumber = 0
    let oldRegistrationSignal: AbortSignal | null | undefined
    const requestSpy = vi
      .spyOn(httpClient, "request")
      .mockImplementation(async (input) => {
        requestNumber += 1
        if (requestNumber === 1) {
          oldRegistrationSignal = input.init?.signal
          await oldGate.promise
          return makeTokenResponse("late-old-token")
        }
        return makeTokenResponse("new-token")
      })

    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = api.getDeviceToken(rateLimitService, firstController.signal)
    const second = api.getDeviceToken(rateLimitService, secondController.signal)
    expect(requestSpy).toHaveBeenCalledOnce()

    firstController.abort()
    secondController.abort()
    oldGate.resolve()
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    await expect(second).rejects.toMatchObject({ name: "AbortError" })
    expect(oldRegistrationSignal?.aborted).toBe(true)

    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
      "new-token"
    )
    expect(requestSpy).toHaveBeenCalledTimes(2)

    oldGate.resolve()
    await Promise.resolve()
    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
      "new-token"
    )
    expect(requestSpy).toHaveBeenCalledTimes(2)
  })

  it("rejects a registration at the hard deadline while its response body is pending", async () => {
    vi.useFakeTimers()
    const { api, httpClient } = await loadFreshApi()
    const body = Promise.withResolvers<ArrayBuffer>()
    let registrationSignal: AbortSignal | null | undefined
    const requestSpy = vi
      .spyOn(httpClient, "request")
      .mockImplementation(async (input) => {
        registrationSignal = input.init?.signal
        return {
          ok: true,
          status: 200,
          arrayBuffer: () => body.promise,
        } as unknown as Response
      })

    const pending = api.getDeviceToken(rateLimitService)
    expect(requestSpy).toHaveBeenCalledOnce()

    const settled = pending.then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error })
    )
    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS)
    const outcome = await Promise.race([
      settled,
      Promise.resolve({ kind: "pending" as const }),
    ])

    const lateBodyResponse = makeTokenResponse("late-body-token")
    body.resolve(await lateBodyResponse.arrayBuffer())
    await Promise.resolve()

    expect(outcome.kind).toBe("rejected")
    if (outcome.kind === "rejected") {
      expect(outcome.error).toMatchObject({
        message: "MangaMillion device registration timed out.",
      })
    }
    expect(registrationSignal?.aborted).toBe(true)

    requestSpy.mockResolvedValueOnce(makeTokenResponse("after-deadline"))
    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
      "after-deadline"
    )
  })

  it("cleans up a failed registration so the next attempt can succeed", async () => {
    const { api, httpClient } = await loadFreshApi()
    const requestSpy = vi
      .spyOn(httpClient, "request")
      .mockRejectedValueOnce(new Error("registration unavailable"))
      .mockResolvedValueOnce(makeTokenResponse("recovered-token"))

    await expect(api.getDeviceToken(rateLimitService)).rejects.toThrow(
      "registration unavailable"
    )
    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
      "recovered-token"
    )
    expect(requestSpy).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, "caller-left"])(
    "honors an already-aborted cached caller (%s)",
    async (reason) => {
      const { api, httpClient } = await loadFreshApi()
      const requestSpy = vi
        .spyOn(httpClient, "request")
        .mockResolvedValue(makeTokenResponse("cached-token"))
      await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
        "cached-token"
      )

      const controller = new AbortController()
      controller.abort(reason)
      await expect(
        api.getDeviceToken(rateLimitService, controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" })
      expect(requestSpy).toHaveBeenCalledOnce()
    }
  )

  it("shares one newer registration across concurrent rejected-token refreshes", async () => {
    const { api, httpClient } = await loadFreshApi()
    const refreshGate = Promise.withResolvers<void>()
    const requestSpy = vi.spyOn(httpClient, "request")
    let registrationCount = 0
    let titleRequestCount = 0
    requestSpy.mockImplementation(async (input) => {
      if (input.url.endsWith("/api/register")) {
        registrationCount += 1
        if (registrationCount === 1) return makeTokenResponse("old-token")
        await refreshGate.promise
        return makeTokenResponse("new-token")
      }

      titleRequestCount += 1
      if (titleRequestCount <= 2) {
        return { ok: false, status: 401 } as unknown as Response
      }
      return makeTitleResponse()
    })

    await expect(api.getDeviceToken(rateLimitService)).resolves.toBe(
      "old-token"
    )
    const first = api.fetchTitleDetail(1, "en", rateLimitService)
    const second = api.fetchTitleDetail(1, "en", rateLimitService)

    await vi.waitFor(() => expect(registrationCount).toBe(2))
    expect(titleRequestCount).toBe(2)
    refreshGate.resolve()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.serviceTitle?.serviceTitleName).toBe("One Piece")
    expect(secondResult.serviceTitle?.serviceTitleName).toBe("One Piece")
    expect(registrationCount).toBe(2)
    expect(titleRequestCount).toBe(4)

    const retryHeaders = requestSpy.mock.calls
      .filter(([input]) => !input.url.endsWith("/api/register"))
      .slice(2)
      .map(
        ([input]) =>
          (input.init?.headers as Record<string, string>)["Access-Token"]
      )
    expect(retryHeaders).toEqual(["new-token", "new-token"])
  })
})
