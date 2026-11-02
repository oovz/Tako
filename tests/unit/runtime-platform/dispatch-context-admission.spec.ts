import { afterEach, describe, expect, it } from "vitest"
import { readSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context-envelope"
import { resolveSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { setEnablementMap } from "@/src/site-integrations/catalog"

afterEach(() => setEnablementMap({}))

describe("dispatch context admission", () => {
  it("admits absent optional context and context-free integrations", () => {
    expect(
      readSiteIntegrationDispatchContext("mangadex", undefined)
    ).toBeUndefined()
    expect(
      readSiteIntegrationDispatchContext("manganato", undefined)
    ).toBeUndefined()
    expect(() =>
      readSiteIntegrationDispatchContext("unknown-integration", undefined)
    ).toThrow(Error)
  })

  it("keeps disabled optional adapter context unavailable", async () => {
    setEnablementMap({ mangadex: false })
    await expect(
      resolveSiteIntegrationDispatchContext({
        siteIntegrationId: "mangadex",
        taskId: "task-1",
        seriesKey: "mangadex#series-1",
        chapter: {
          id: "chapter-1",
          title: "One",
          url: "https://mangadex.org/chapter/1",
          comicInfo: {},
        },
        settingsSnapshot: createTaskSettingsSnapshot(
          DEFAULT_SETTINGS,
          "mangadex"
        ),
        siteIntegrationSettingsReader: {
          getAll: async () => ({}),
          getForSite: async () => ({}),
        },
      })
    ).resolves.toBeUndefined()
  })
})
