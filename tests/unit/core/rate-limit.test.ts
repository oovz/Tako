/** Explicit per-runtime rate-limit service tests. */

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  RateLimitService,
  StorageRateLimitPolicySource,
} from "@/src/runtime/rate-limit"

const bottleneckMock = vi.fn()

vi.mock("bottleneck/light", () => ({
  default: class MockBottleneck {
    schedule: ReturnType<typeof vi.fn>

    constructor(config: unknown) {
      bottleneckMock(config)
      this.schedule = vi
        .fn()
        .mockImplementation((task: () => unknown) => task())
    }

    disconnect(): void {}
  },
}))

describe("RateLimitService", () => {
  const settingsReader = {
    getGlobalPolicy: vi.fn(async () => ({
      image: { concurrency: 2, delayMs: 500 },
      chapter: { concurrency: 2, delayMs: 1000 },
    })),
  }
  const overridesReader = {
    getAll: vi.fn(async () => ({})),
  }
  const getSiteDefaults = vi.fn<
    (
      integrationId: string,
      scope: "image" | "chapter"
    ) => { concurrency?: number; delayMs?: number } | undefined
  >(() => undefined)

  let service: RateLimitService

  beforeEach(() => {
    vi.clearAllMocks()
    settingsReader.getGlobalPolicy.mockResolvedValue({
      image: { concurrency: 2, delayMs: 500 },
      chapter: { concurrency: 2, delayMs: 1000 },
    })
    overridesReader.getAll.mockResolvedValue({})
    getSiteDefaults.mockReturnValue(undefined)
    service = new RateLimitService(
      new StorageRateLimitPolicySource({
        settingsReader,
        overridesReader,
        getSiteDefaults,
      })
    )
  })

  it("uses the explicit storage-backed policy source", async () => {
    await service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "result"
    )

    expect(settingsReader.getGlobalPolicy).toHaveBeenCalledOnce()
    expect(overridesReader.getAll).toHaveBeenCalledOnce()
  })

  it("merges partial site overrides over integration defaults and global policy", async () => {
    overridesReader.getAll.mockResolvedValueOnce({
      "test-integration": { imagePolicy: { concurrency: 8 } },
    })
    getSiteDefaults.mockReturnValueOnce({ concurrency: 3, delayMs: 250 })

    await expect(
      service.resolveEffectivePolicy("test-integration", "image")
    ).resolves.toEqual({ concurrency: 8, delayMs: 250 })
  })

  it("reuses a limiter for the same integration and scope", async () => {
    await service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "task1"
    )
    await service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "task2"
    )

    expect(bottleneckMock).toHaveBeenCalledOnce()
  })

  it("clears process-local limiters when the composition root invalidates policy", async () => {
    await service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "first"
    )
    service.cleanupRateLimiters()
    await service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "second"
    )

    expect(bottleneckMock).toHaveBeenCalledTimes(2)
  })

  it("uses separate limiters per scope", async () => {
    const imageResult = await service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "image-task"
    )
    const chapterResult = await service.scheduleForIntegrationScope(
      "test-integration",
      "chapter",
      async () => "chapter-task"
    )

    expect(imageResult).toBe("image-task")
    expect(chapterResult).toBe("chapter-task")
    expect(bottleneckMock).toHaveBeenCalledTimes(2)
  })

  it("executes scheduled tasks and propagates task errors", async () => {
    await expect(
      service.scheduleForIntegrationScope(
        "test-integration",
        "image",
        async () => {
          throw new Error("Task failed")
        }
      )
    ).rejects.toThrow("Task failed")
  })

  it("propagates policy source failures instead of consulting ambient storage", async () => {
    overridesReader.getAll.mockRejectedValueOnce(
      new Error("storage unavailable")
    )

    await expect(
      service.scheduleForIntegrationScope(
        "test-integration",
        "image",
        async () => "result"
      )
    ).rejects.toThrow("storage unavailable")
  })
})
