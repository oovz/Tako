import { createCipheriv, createDecipheriv } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://www.aimanhua.org"
const cdn = "https://img1.baipiaoguai.org"
const series = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/lovemanga/series.html",
    import.meta.url
  ),
  "utf8"
)
const capturedReader = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/lovemanga/reader-upload3.html",
    import.meta.url
  ),
  "utf8"
)
const capturedEnvelope = Buffer.from(
  capturedReader.match(/params\s*=\s*'([^']+)'/)![1],
  "base64"
)
const key = Buffer.from("9S8$vJnU2ANeSRoF")
const decipher = createDecipheriv(
  "aes-128-cbc",
  key,
  capturedEnvelope.subarray(0, 16)
)
const params = JSON.parse(
  Buffer.concat([
    decipher.update(capturedEnvelope.subarray(16)),
    decipher.final(),
  ]).toString("utf8")
)
// Keep the captured identity and first two issued URLs for the browser save test.
// The source fixture retains all 179 pages for the complete-plan parser test.
params.images = params.images.slice(0, 2)
const iv = Buffer.from("fixtureIV1234567")
const cipher = createCipheriv("aes-128-cbc", key, iv)
const envelope = Buffer.concat([
  iv,
  cipher.update(JSON.stringify(params)),
  cipher.final(),
]).toString("base64")
const reader = capturedReader.replace(
  /params\s*=\s*'[^']+'/,
  `params='${envelope}'`
)

export const aimanhuaFixture = createExpandedSiteFixture({
  testCase: {
    id: "lovemanga",
    seriesUrl: `${origin}/comic/416895`,
    seriesId: "416895",
    title: "A.I. 医生",
    chapterId: "221966",
    pageCount: 2,
  },
  origins: [origin, cdn],
  firstRuleId: 9920,
  handle: ({ url }) => {
    if (url.origin === cdn) return pngResponse()
    if (url.pathname === "/comic/416895") return htmlResponse(series)
    if (url.pathname === "/chapter/416895/221966") return htmlResponse(reader)
    return null
  },
})
export const registerAimanhuaRoutes = aimanhuaFixture.registerRoutes
export const registerAimanhuaLocalServerHandlers =
  aimanhuaFixture.registerLocalServerHandlers
