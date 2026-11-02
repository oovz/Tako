import { afterEach, describe, expect, it } from "vitest"
import {
  getBackgroundSiteAdapterById,
  validateBackgroundSiteIntegrations,
} from "@/src/runtime/background-site-integration-initialization"
import { setEnablementMap } from "@/src/site-integrations/catalog"

afterEach(() => setEnablementMap({}))

describe("background adapter availability", () => {
  it("validates startup adapters and only resolves enabled shipped integrations", async () => {
    setEnablementMap({ mangadex: true })
    expect(() => validateBackgroundSiteIntegrations()).not.toThrow()
    const adapter = await getBackgroundSiteAdapterById("mangadex")
    expect(typeof adapter?.background.series?.resolveSeriesData).toBe(
      "function"
    )
    setEnablementMap({ mangadex: false })
    expect(() => validateBackgroundSiteIntegrations()).not.toThrow()
    await expect(
      getBackgroundSiteAdapterById("mangadex")
    ).resolves.toBeUndefined()
    await expect(
      getBackgroundSiteAdapterById("unknown-integration")
    ).resolves.toBeUndefined()
  })
})
