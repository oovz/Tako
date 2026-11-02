// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createOffscreenStatusController } from "@/entrypoints/offscreen/status-ui"

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("offscreen status controller", () => {
  it("reflects initialization, active work and later failures in the status document", () => {
    document.body.innerHTML =
      '<div id="offscreen-status"></div><div id="offscreen-health"></div><div id="offscreen-error"></div><div id="jobs">stale</div><div id="jobs-empty"></div>'
    let activeJobs = 0
    const controller = createOffscreenStatusController({
      getActiveJobCount: () => activeJobs,
    })
    controller.initializeDom()
    const health = document.getElementById("offscreen-health")!
    const error = document.getElementById("offscreen-error")!
    expect(health.dataset.ready).toBe("false")
    expect(document.getElementById("jobs")?.textContent).toBe("")
    expect(error.hidden).toBe(true)

    activeJobs = 2
    controller.onInitialized()
    expect(health.dataset.ready).toBe("true")
    expect(health.dataset.activeJobs).toBe("2")
    controller.onInitializationError("Registry unavailable")
    expect(health.dataset.ready).toBe("false")
    expect(error.hidden).toBe(false)
    expect(error.textContent).toContain("Registry unavailable")

    controller.onInitialized()
    expect(error.hidden).toBe(true)
    controller.reportBootstrapError(new Error("DOM initialization failed"))
    expect(health.dataset.ready).toBe("false")
    expect(error.textContent).toContain("DOM initialization failed")
    controller.reportBootstrapError(undefined)
    expect(error.hidden).toBe(false)
    expect(error.textContent?.length).toBeGreaterThan(0)
  })

  it("retains initialization state while optional status nodes are absent", () => {
    const controller = createOffscreenStatusController({
      getActiveJobCount: () => 0,
    })
    controller.initializeDom()
    controller.onInitializationError("Unavailable")
    controller.onInitialized()
    document.body.innerHTML =
      '<div id="offscreen-health"></div><div id="offscreen-error"></div>'
    controller.initializeDom()
    expect(document.getElementById("offscreen-health")?.dataset.ready).toBe(
      "true"
    )
    expect(document.getElementById("offscreen-error")?.hidden).toBe(true)
  })
})
