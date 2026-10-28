import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import contract from "@/tests/fixtures/site-integrations/coolmic/contract.json" with { type: "json" }
import {
  createExpandedSiteFixture,
  htmlResponse,
  jsonResponse,
  PAGE_PNG,
} from "../expanded-site-fixture"

const origin = "https://coolmic.me"
const cdn = "https://en-contents.coolmic.me"
const titlePage = readFileSync(
  resolve("tests/fixtures/site-integrations/coolmic/title-page.html"),
  "utf8"
)
const imagePaths = new Set(
  contract.data.viewer.image_data.map((image) => new URL(image.path).pathname)
)

export const coolmicFixture = createExpandedSiteFixture({
  testCase: {
    id: "coolmic",
    seriesUrl: `${origin}/titles/5101`,
    seriesId: "5101",
    title: "Love Me! P.S. I'm Awesome",
    chapterId: "130687",
    pageCount: 31,
  },
  origins: [origin, cdn, "https://en-img.coolmic.me"],
  firstRuleId: 9928,
  handle: ({ url }) => {
    if (url.origin === cdn) {
      if (!imagePaths.has(url.pathname)) return null
      if (
        !["Policy", "Signature", "Key-Pair-Id"].every((key) =>
          url.searchParams.has(key)
        )
      )
        return { status: 403, body: "Signed viewer credentials missing" }
      return {
        status: 200,
        headers: { "content-type": "binary/octet-stream" },
        body: PAGE_PNG,
      }
    }
    if (url.hostname === "en-img.coolmic.me")
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        body: PAGE_PNG,
      }
    if (url.pathname === "/titles/5101") return htmlResponse(titlePage)
    if (url.pathname === "/api/v1/viewer/episodes/130687")
      return jsonResponse(contract.data.viewer)
    return null
  },
})
export const registerCoolmicRoutes = coolmicFixture.registerRoutes
export const registerCoolmicLocalServerHandlers =
  coolmicFixture.registerLocalServerHandlers
