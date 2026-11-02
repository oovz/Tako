import { afterEach, describe, expect, it } from "vitest"
import { OffscreenWorker } from "@/entrypoints/offscreen/main-worker"

const originalMemory = Object.getOwnPropertyDescriptor(performance, "memory")
afterEach(() => {
  if (originalMemory)
    Object.defineProperty(performance, "memory", originalMemory)
  else Reflect.deleteProperty(performance, "memory")
})

describe("offscreen worker memory diagnostics", () => {
  it("reports available heap measurements in MiB and tolerates an absent capability", () => {
    const worker = new OffscreenWorker("memory-diagnostics")
    Reflect.deleteProperty(performance, "memory")
    expect(worker.getMemoryStats()).toBeNull()
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: {
        usedJSHeapSize: 2 * 1024 * 1024,
        totalJSHeapSize: 4 * 1024 * 1024,
        jsHeapSizeLimit: 8 * 1024 * 1024,
      },
    })
    expect(worker.getMemoryStats()).toEqual({
      usedMB: 2,
      totalMB: 4,
      limitMB: 8,
    })
  })
})
