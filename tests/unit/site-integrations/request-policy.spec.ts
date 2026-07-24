import { describe, expect, it, vi } from "vitest"

import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image-core"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
  assertSafePublicHttpsUrl,
  createSameOriginDynamicAssetAssertion,
} from "@/src/site-integrations/request-policy"

describe("site integration request policy", () => {
  it.each([
    ["mangadex", "https://api.mangadex.org/manga/example"],
    ["pixiv-comic", "https://img-comic.pximg.net/pages/1.webp"],
    [
      "shonenjumpplus",
      "https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg",
    ],
    ["manhuagui", "https://i.hamreus.com/ps3/1.jpg"],
    ["comicnettai", "https://cdn.comicnettai.com/123/page.jpeg"],
  ])("allows a declared %s origin", (integrationId, url) => {
    expect(assertIntegrationRequestUrl(integrationId, url).href).toBe(url)
  })

  it.each([
    ["mangadex", "https://api.mangadex.org.attacker.example/manga/example"],
    ["pixiv-comic", "https://pximg.net.attacker.example/page.webp"],
    [
      "shonenjumpplus",
      "https://cdn-ak-img.shonenjumpplus.com.attacker.example/public/page/1.jpg",
    ],
    ["manhuagui", "https://hamreus.com.attacker.example/page.jpg"],
    ["comicnettai", "https://cdn.comicnettai.com.attacker.example/page.jpeg"],
  ])("blocks a lookalike %s origin", (integrationId, url) => {
    expect(() => assertIntegrationRequestUrl(integrationId, url)).toThrow(
      "Blocked untrusted"
    )
  })

  it.each([
    "http://api.mangadex.org/manga/example",
    "https://user:password@example.com/image.jpg",
    "https://localhost/image.jpg",
    "https://service.local/image.jpg",
    "https://127.0.0.1/image.jpg",
    "https://2130706433/image.jpg",
    "https://10.0.0.1/image.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/image.jpg",
    "https://[fc00::1]/image.jpg",
    "https://[fe80::1]/image.jpg",
    "https://[::ffff:127.0.0.1]/image.jpg",
  ])("blocks non-public or unsafe URL %s", (url) => {
    expect(() => assertSafePublicHttpsUrl(url)).toThrow("Blocked")
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
    ).toThrow("cross-origin redirect")
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
      assertIntegrationResponseUrl(
        "pixiv-comic",
        "https://comic.pixiv.net/api/app/works/v5/1",
        "https://attacker.example/api/app/works/v5/1"
      )
    ).toThrow("Blocked untrusted Pixiv Comic request URL")
  })
})
