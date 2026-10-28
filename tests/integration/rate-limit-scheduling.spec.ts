import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  RateLimitService,
  type EffectivePolicy,
} from "@/src/runtime/rate-limit"

const services: RateLimitService[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(async () => {
  services.splice(0).forEach((service) => service.cleanupRateLimiters())
  await vi.runAllTimersAsync()
  vi.useRealTimers()
})

describe("rate-limit scheduling", () => {
  it.each(["cold", "warm", "explicit"] as const)(
    "enforces concurrency and start spacing for simultaneous %s calls",
    async (mode) => {
      const resolveEffectivePolicy = vi.fn(async () => ({
        concurrency: 2,
        delayMs: 30,
      }))
      const service = new RateLimitService({ resolveEffectivePolicy })
      services.push(service)
      const policy =
        mode === "explicit" ? { concurrency: 2, delayMs: 30 } : undefined
      if (mode === "warm") {
        const warmup = service.scheduleForIntegrationScope(
          "test-integration",
          "image",
          async () => undefined
        )
        await vi.runAllTimersAsync()
        await warmup
      }
      const starts: number[] = []
      let active = 0
      let peak = 0
      const results = Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          service.scheduleForIntegrationScope(
            "test-integration",
            "image",
            async () => {
              starts.push(Date.now())
              peak = Math.max(peak, ++active)
              await new Promise((resolve) => setTimeout(resolve, 100))
              active--
              return index
            },
            policy
          )
        )
      )

      await vi.runAllTimersAsync()

      expect(await results).toEqual([0, 1, 2, 3, 4, 5])
      expect(peak).toBe(2)
      for (let index = 1; index < starts.length; index++) {
        expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(30)
      }
      if (mode === "explicit") {
        expect(resolveEffectivePolicy).not.toHaveBeenCalled()
      } else {
        expect(resolveEffectivePolicy).toHaveBeenCalledExactlyOnceWith(
          "test-integration",
          "image"
        )
      }
    }
  )

  it("allows a later request to initialize after concurrent lookup failures", async () => {
    const failure = new Error("policy storage unavailable")
    const resolveEffectivePolicy = vi
      .fn(async () => ({ concurrency: 1, delayMs: 0 }))
      .mockRejectedValueOnce(failure)
    const service = new RateLimitService({ resolveEffectivePolicy })
    services.push(service)
    const task = vi.fn(async () => "done")
    const failures = await Promise.allSettled([
      service.scheduleForIntegrationScope("test-integration", "image", task),
      service.scheduleForIntegrationScope("test-integration", "image", task),
    ])

    expect(failures).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ])
    expect(task).not.toHaveBeenCalled()
    expect(resolveEffectivePolicy).toHaveBeenCalledOnce()

    const retry = service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      task
    )
    await vi.runAllTimersAsync()

    expect(await retry).toBe("done")
    expect(task).toHaveBeenCalledOnce()
    expect(resolveEffectivePolicy).toHaveBeenCalledTimes(2)
  })

  it("keeps the current scheduler when an invalidated lookup resolves later", async () => {
    const stalePolicy = Promise.withResolvers<EffectivePolicy>()
    const currentPolicy = { concurrency: 1, delayMs: 40 }
    const resolveEffectivePolicy = vi
      .fn(async () => currentPolicy)
      .mockReturnValueOnce(stalePolicy.promise)
    const service = new RateLimitService({ resolveEffectivePolicy })
    services.push(service)
    const stale = service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "stale"
    )
    service.cleanupRateLimiters()
    const current = service.scheduleForIntegrationScope(
      "test-integration",
      "image",
      async () => "current"
    )
    expect(resolveEffectivePolicy).toHaveBeenCalledTimes(2)
    await vi.runAllTimersAsync()
    expect(await current).toBe("current")

    stalePolicy.resolve({ concurrency: 5, delayMs: 0 })
    await vi.runAllTimersAsync()
    expect(await stale).toBe("stale")

    const starts: number[] = []
    let active = 0
    let peak = 0
    const results = Promise.all(
      Array.from({ length: 3 }, () =>
        service.scheduleForIntegrationScope(
          "test-integration",
          "image",
          async () => {
            starts.push(Date.now())
            peak = Math.max(peak, ++active)
            await new Promise((resolve) => setTimeout(resolve, 10))
            active--
          }
        )
      )
    )
    await vi.runAllTimersAsync()
    await results

    expect(peak).toBe(1)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(40)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(40)
    expect(resolveEffectivePolicy).toHaveBeenCalledTimes(2)
  })

  it.each(["resolve", "reject"] as const)(
    "shares a pending current lookup after an invalidated lookup %ss",
    async (outcome) => {
      const stalePolicy = Promise.withResolvers<EffectivePolicy>()
      const currentPolicy = Promise.withResolvers<EffectivePolicy>()
      const resolveEffectivePolicy = vi
        .fn(() => currentPolicy.promise)
        .mockReturnValueOnce(stalePolicy.promise)
      const service = new RateLimitService({ resolveEffectivePolicy })
      services.push(service)
      const stale = Promise.allSettled([
        service.scheduleForIntegrationScope(
          "test-integration",
          "image",
          async () => "stale"
        ),
      ])
      service.cleanupRateLimiters()
      const starts: number[] = []
      const task = async () => {
        starts.push(Date.now())
        return "current"
      }
      const first = service.scheduleForIntegrationScope(
        "test-integration",
        "image",
        task
      )
      const failure = new Error("stale lookup failed")
      if (outcome === "resolve") {
        stalePolicy.resolve({ concurrency: 5, delayMs: 0 })
      } else {
        stalePolicy.reject(failure)
      }
      await vi.runAllTimersAsync()
      expect(await stale).toEqual([
        outcome === "resolve"
          ? { status: "fulfilled", value: "stale" }
          : { status: "rejected", reason: failure },
      ])

      const second = service.scheduleForIntegrationScope(
        "test-integration",
        "image",
        task
      )
      expect(resolveEffectivePolicy).toHaveBeenCalledTimes(2)
      expect(starts).toEqual([])
      currentPolicy.resolve({ concurrency: 1, delayMs: 40 })
      await vi.runAllTimersAsync()

      expect(await Promise.all([first, second])).toEqual(["current", "current"])
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(40)
    }
  )

  it.each(["service", "integration", "scope", "explicit policy"] as const)(
    "schedules independently across a different %s",
    async (boundary) => {
      const resolveEffectivePolicy = vi.fn(async () => ({
        concurrency: 1,
        delayMs: 0,
      }))
      const service = new RateLimitService({ resolveEffectivePolicy })
      const otherService =
        boundary === "service"
          ? new RateLimitService({ resolveEffectivePolicy })
          : service
      services.push(service)
      if (otherService !== service) services.push(otherService)
      let active = 0
      let peak = 0
      const task = async () => {
        peak = Math.max(peak, ++active)
        await new Promise((resolve) => setTimeout(resolve, 100))
        active--
      }
      const results = Promise.all([
        service.scheduleForIntegrationScope("test-integration", "image", task),
        otherService.scheduleForIntegrationScope(
          boundary === "integration" ? "other-integration" : "test-integration",
          boundary === "scope" ? "chapter" : "image",
          task,
          boundary === "explicit policy"
            ? { concurrency: 1, delayMs: 0 }
            : undefined
        ),
      ])
      await vi.runAllTimersAsync()
      await results

      expect(peak).toBe(2)
      expect(resolveEffectivePolicy).toHaveBeenCalledTimes(
        boundary === "explicit policy" ? 1 : 2
      )
    }
  )
})
