import { afterEach, expect, it, vi } from "vitest"
import { withRetries } from "@/entrypoints/offscreen/image-processor"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"

vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: async () => ({
    success: true,
    deviceToken: "test-token",
  }),
}))

const rateLimitService = {
  scheduleForIntegrationScope: async <T>(
    _integrationId: string,
    _scope: string,
    operation: () => Promise<T>
  ) => operation(),
} as unknown as RateLimitService

afterEach(() => vi.unstubAllGlobals())

it.each([
  ["mangaplus", "1605201", "https://mangaplus.shueisha.co.jp/viewer/1605201"],
  ["coolmic", "10", "https://coolmic.me/episodes/10"],
  ["mangamillion", "1", "https://mangamillion.shueisha.co.jp/en/1"],
] as const)(
  "retries a %s chapter HTTP 503 and stops at a subsequent chapter HTTP 404",
  async (siteId, id, url) => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }))
    fetch.mockImplementationOnce(
      async () => new Response(null, { status: 503 })
    )
    vi.stubGlobal("fetch", fetch)
    const settings = createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteId)
    const resolve = () =>
      offscreenSiteAdaptersById[siteId].offscreen.chapter.resolveChapterPlan(
        { id, url },
        {
          settings,
          runtime: {
            rateLimitService,
            rateLimitSettings: settings.rateLimitSettings,
          },
        }
      )

    await expect(
      withRetries(resolve, settings.retrySettings.chapter, 0)
    ).rejects.toMatchObject({ status: 404 })
    expect(fetch).toHaveBeenCalledTimes(2)
  }
)
