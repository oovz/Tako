import { describe, expect, it, vi } from "vitest"

import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image-core"
import {
  assertIntegrationEndpointRequestUrl,
  assertIntegrationEndpointResponseUrl,
  assertSafePublicHttpsUrl,
  createSameOriginDynamicAssetAssertion,
} from "@/src/site-integrations/request-policy"
import { integrationHttpClient as integrationHttpClientImpl } from "@/src/site-integrations/http-client"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService
const integrationHttpClient: typeof integrationHttpClientImpl =
  integrationHttpClientImpl

describe("site integration request policy", () => {
  it.each([
    ["mangadex", "mangadex-api", "https://api.mangadex.org/manga/example"],
    [
      "pixiv-comic",
      "pixiv-comic-image-cdn",
      "https://img-comic.pximg.net/pages/1.webp",
    ],
    [
      "shonenjumpplus",
      "shonenjumpplus-image-cdn",
      "https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg",
    ],
    ["manhuagui", "manhuagui-image-cdn", "https://i.hamreus.com/ps3/1.jpg"],
    [
      "comicnettai",
      "comicnettai-cdn-image",
      "https://cdn.comicnettai.com/123/page.jpeg",
    ],
  ])(
    "allows a declared %s endpoint origin",
    (integrationId, endpointId, url) => {
      expect(
        assertIntegrationEndpointRequestUrl(integrationId, endpointId, url).href
      ).toBe(url)
    }
  )

  it.each([
    [
      "mangadex",
      "mangadex-api",
      "https://api.mangadex.org.attacker.example/manga/example",
    ],
    [
      "pixiv-comic",
      "pixiv-comic-image-cdn",
      "https://pximg.net.attacker.example/page.webp",
    ],
    [
      "shonenjumpplus",
      "shonenjumpplus-image-cdn",
      "https://cdn-ak-img.shonenjumpplus.com.attacker.example/public/page/1.jpg",
    ],
    [
      "manhuagui",
      "manhuagui-image-cdn",
      "https://hamreus.com.attacker.example/page.jpg",
    ],
    [
      "comicnettai",
      "comicnettai-cdn-image",
      "https://cdn.comicnettai.com.attacker.example/page.jpeg",
    ],
  ])(
    "blocks a lookalike %s endpoint origin",
    (integrationId, endpointId, url) => {
      expect(() =>
        assertIntegrationEndpointRequestUrl(integrationId, endpointId, url)
      ).toThrow("Blocked untrusted")
    }
  )

  it.each([
    "http://api.mangadex.org/manga/example",
    "https://user:password@example.com/image.jpg",
    "https://localhost/image.jpg",
    "https://localhost./image.jpg",
    "https://service.local/image.jpg",
    "https://service.local./image.jpg",
    "https://home.arpa./image.jpg",
    "https://127.0.0.1/image.jpg",
    "https://2130706433/image.jpg",
    "https://10.0.0.1/image.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/image.jpg",
    "https://[fc00::1]/image.jpg",
    "https://[fe80::1]/image.jpg",
    "https://[::ffff:127.0.0.1]/image.jpg",
  ])("blocks non-public or unsafe URL %s", (url) => {
    expect(() => assertSafePublicHttpsUrl(url)).toThrow(ProviderContractError)
  })

  it("permits a dynamic public image origin but blocks a cross-origin redirect", () => {
    const assertDynamicUrl = createSameOriginDynamicAssetAssertion(
      "https://uploads-node.example.net/data/chapter/page.jpg",
      "MangaDex@Home image request"
    )

    expect(() =>
      assertDynamicUrl(
        "https://uploads-node.example.net/data/chapter/page-final.jpg"
      )
    ).not.toThrow()
    expect(() =>
      assertDynamicUrl("https://attacker.example/page-final.jpg")
    ).toThrow(ProviderContractError)
  })

  it("rejects redirects at fetch time and checks the final URL defensively", async () => {
    const assertDynamicUrl = createSameOriginDynamicAssetAssertion(
      "https://uploads-node.example.net/data/page.jpg",
      "dynamic image request"
    )
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error")
      return {
        ok: true,
        url: "https://attacker.example/redirected.jpg",
        headers: new Headers({ "content-type": "image/jpeg" }),
        body: null,
        arrayBuffer,
      } as unknown as Response
    })

    await expect(
      fetchImageWithStallDetection(
        "https://uploads-node.example.net/data/page.jpg",
        {
          assertUrlAllowed: assertDynamicUrl,
          fetcher,
        }
      )
    ).rejects.toThrow("cross-origin redirect")
    expect(fetcher).toHaveBeenCalledOnce()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it("validates fixed-origin response redirects against the manifest", () => {
    expect(() =>
      assertIntegrationEndpointResponseUrl(
        "pixiv-comic",
        "pixiv-comic-works-api",
        "https://comic.pixiv.net/api/app/works/v5/1",
        "https://attacker.example/api/app/works/v5/1"
      )
    ).toThrow("Blocked untrusted Pixiv Comic work metadata response URL")
  })

  it("requires an exact generated endpoint and enforces endpoint origins", () => {
    expect(() =>
      assertIntegrationEndpointRequestUrl(
        "mangadex",
        "missing-endpoint",
        "https://api.mangadex.org/manga/example"
      )
    ).toThrow("Unknown endpoint")
    expect(() =>
      assertIntegrationEndpointRequestUrl(
        "mangadex",
        "mangadex-api",
        "https://uploads.mangadex.org/manga/example"
      )
    ).toThrow("Blocked untrusted")
  })

  it("allows public provider-issued wildcard URLs but rejects private hosts", () => {
    expect(
      assertIntegrationEndpointRequestUrl(
        "mangadex",
        "mangadex-at-home-image",
        "https://node.example.net/data/page.jpg"
      ).href
    ).toBe("https://node.example.net/data/page.jpg")
    expect(() =>
      assertIntegrationEndpointRequestUrl(
        "mangadex",
        "mangadex-at-home-image",
        "https://127.0.0.1/data/page.jpg"
      )
    ).toThrow("non-public")
  })

  it("rejects credential and response-size policy mismatches before body use", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("payload", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "10000001",
        },
      })
    )
    vi.stubGlobal("fetch", fetcher)

    await expect(
      integrationHttpClient.request({
        integrationId: "mangadex",
        endpointId: "mangadex-api",
        url: "https://api.mangadex.org/manga/example",
        scope: "chapter",
        skipRateLimit: true,
        rateLimitService,
        init: { credentials: "include" },
      })
    ).rejects.toThrow("credentials mismatch")
    expect(fetcher).not.toHaveBeenCalled()

    await expect(
      integrationHttpClient.request({
        integrationId: "mangadex",
        endpointId: "mangadex-api",
        url: "https://api.mangadex.org/manga/example",
        scope: "chapter",
        skipRateLimit: true,
        rateLimitService,
      })
    ).rejects.toThrow("Response body exceeds")
  })

  it("bounds a chunked response without a content-length header", async () => {
    const oversizedChunk = new Uint8Array(1_000_001)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(oversizedChunk)
              controller.close()
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    )

    const response = await integrationHttpClient.request({
      integrationId: "mangadex",
      endpointId: "mangadex-network-report",
      url: "https://api.mangadex.network/report",
      scope: "chapter",
      skipRateLimit: true,
      rateLimitService,
    })

    await expect(response.arrayBuffer()).rejects.toThrow(
      "Response body exceeds 1000000 byte limit"
    )
  })

  it("enforces endpoint redirect response origins", () => {
    expect(() =>
      assertIntegrationEndpointResponseUrl(
        "pixiv-comic",
        "pixiv-comic-works-api",
        "https://comic.pixiv.net/api/app/works/v5/1",
        "https://attacker.example/redirected"
      )
    ).toThrow("Blocked untrusted")
  })

  it("enforces the declared successful response media type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>challenge</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      )
    )

    await expect(
      integrationHttpClient.request({
        integrationId: "mangadex",
        endpointId: "mangadex-api",
        url: "https://api.mangadex.org/manga/example",
        scope: "chapter",
        skipRateLimit: true,
        rateLimitService,
      })
    ).rejects.toThrow("does not match declared json endpoint")
  })

  it("models the Pixiv application shell as HTML instead of a JSON API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          '<script src="/_next/static/build-123/_buildManifest.js"></script>',
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }
        )
      )
    )

    const response = await integrationHttpClient.request({
      integrationId: "pixiv-comic",
      endpointId: "pixiv-comic-homepage",
      url: "https://comic.pixiv.net/",
      scope: "chapter",
      skipRateLimit: true,
      rateLimitService,
      init: { credentials: "include" },
    })

    await expect(response.text()).resolves.toContain("build-123")
  })
})
