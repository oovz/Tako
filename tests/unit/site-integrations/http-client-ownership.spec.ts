import { afterEach, describe, expect, it, vi } from "vitest"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const url = "https://api.mangadex.org/manga/example"
const request = {
  integrationId: "mangadex",
  endpointId: "mangadex-api",
  url,
  scope: "chapter" as const,
  skipRateLimit: true,
  rateLimitService: {} as RateLimitService,
}

afterEach(() => vi.unstubAllGlobals())

describe("HTTP response ownership", () => {
  it("releases a denied response and reports the HTTP status as site access denied", async () => {
    const response = new Response("Forbidden", { status: 403 })
    const cancel = vi.spyOn(response.body!, "cancel")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response)
    )

    await expect(integrationHttpClient.request(request)).rejects.toMatchObject({
      status: 403,
      category: "provider_access_denied",
    })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each<{ headers: Record<string, string>; finalUrl: string; error: string }>(
    [
      {
        headers: {
          "content-type": "application/json",
          "content-length": "10000001",
        },
        finalUrl: url,
        error: "Response body exceeds",
      },
      {
        headers: { "content-type": "text/html" },
        finalUrl: url,
        error: "does not match declared json",
      },
      {
        headers: { "content-type": "application/json" },
        finalUrl: "https://untrusted.example/result",
        error: "Blocked untrusted",
      },
    ]
  )(
    "cancels the unreturned response for $error",
    async ({ headers, finalUrl, error }) => {
      let canceled = false
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
        },
      })
      const response = new Response(body, { headers })
      Object.defineProperty(response, "url", { value: finalUrl })
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response)
      )
      await expect(integrationHttpClient.request(request)).rejects.toThrow(
        error
      )
      expect(canceled).toBe(true)
    }
  )

  it("preserves the policy error when body cancellation rejects", async () => {
    let cancellationAttempted = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellationAttempted = true
        throw new Error("cleanup rejected")
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, { headers: { "content-type": "text/html" } })
      )
    )
    await expect(integrationHttpClient.request(request)).rejects.toThrow(
      "does not match declared json"
    )
    expect(cancellationAttempted).toBe(true)
  })

  it("hands a valid response to its consumer without canceling it", async () => {
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true}'))
        controller.close()
      },
      cancel() {
        canceled = true
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json" },
          })
      )
    )
    const response = await integrationHttpClient.request(request)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(canceled).toBe(false)
  })

  it.each(["throws", "pending", "absent"] as const)(
    "preserves the policy failure when cleanup is %s",
    async (cleanup) => {
      const response = new Response(
        cleanup === "absent" ? null : new ReadableStream(),
        { headers: { "content-type": "text/html" } }
      )
      const cancel = response.body
        ? vi.spyOn(response.body, "cancel").mockImplementation(() => {
            if (cleanup === "throws") throw new Error("cleanup failed")
            return new Promise<void>(() => {})
          })
        : undefined
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response)
      )
      await expect(integrationHttpClient.request(request)).rejects.toThrow(
        "does not match declared json"
      )
      if (cancel) expect(cancel).toHaveBeenCalledOnce()
    }
  )

  it("cancels the source when a handed-off stream exceeds its byte budget", async () => {
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_000_001))
      },
      cancel() {
        canceled = true
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json" },
          })
      )
    )
    const response = await integrationHttpClient.request({
      ...request,
      endpointId: "mangadex-network-report",
      url: "https://api.mangadex.network/report",
    })
    await expect(response.arrayBuffer()).rejects.toThrow(
      "Response body exceeds"
    )
    await vi.waitFor(() => expect(canceled).toBe(true))
  })
})
