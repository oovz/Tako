import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import contract from "@/tests/fixtures/site-integrations/mangaplus/contract.json" with { type: "json" }
import {
  createExpandedSiteFixture,
  htmlResponse,
  PAGE_PNG,
} from "../expanded-site-fixture"

const origin = "https://mangaplus.shueisha.co.jp"
const api = "https://jumpg-webapi.tokyo-cdn.com"
const cdn = "https://jumpg-assets3.tokyo-cdn.com"
const titlePage = readFileSync(
  resolve("tests/fixtures/site-integrations/mangaplus/title-page.html"),
  "utf8"
)
const encrypted = Buffer.from(
  PAGE_PNG.map((byte, index) => byte ^ (index % 2 === 0 ? 1 : 2))
)
const imagePaths = new Set(
  contract.data.imageUrls.map((imageUrl) => new URL(imageUrl).pathname)
)

export const mangaplusFixture = createExpandedSiteFixture({
  testCase: {
    id: "mangaplus",
    seriesUrl: `${origin}/titles/100467`,
    seriesId: "100467",
    title: "Home at the Horizon",
    chapterId: "1030661",
    pageCount: 23,
  },
  origins: [origin, api, cdn, "https://jumpg-assets.tokyo-cdn.com"],
  firstRuleId: 9931,
  handle: ({ url, headers }) => {
    if (url.origin === cdn) {
      if (!imagePaths.has(url.pathname)) return null
      if (headers["plus-vw-token"] !== "synthetic-viewer-token")
        return { status: 403, body: "Viewer token missing" }
      return {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: encrypted,
      }
    }
    if (url.origin === api) {
      if (!headers["session-token"])
        return { status: 403, body: "Viewer session missing" }
      const base64 =
        url.pathname === "/api/title_detailV4" &&
        url.searchParams.get("title_id") === "100467"
          ? contract.data.titleResponseBase64
          : url.pathname === "/api/manga_viewer_v3" &&
              url.searchParams.get("chapter_id") === "1030661"
            ? contract.data.viewerResponseBase64
            : undefined
      return base64
        ? {
            status: 200,
            headers: { "content-type": "application/protobuf" },
            body: Buffer.from(base64, "base64"),
          }
        : null
    }
    if (url.hostname === "jumpg-assets.tokyo-cdn.com")
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        body: PAGE_PNG,
      }
    if (url.pathname === "/titles/100467") return htmlResponse(titlePage)
    return null
  },
})
export const registerMangaplusRoutes = mangaplusFixture.registerRoutes
export const registerMangaplusLocalServerHandlers =
  mangaplusFixture.registerLocalServerHandlers
