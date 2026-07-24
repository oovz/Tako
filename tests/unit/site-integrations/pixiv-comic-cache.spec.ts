import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  PIXIV_BUILD_ID_CACHE_MAX_SIZE,
  cachePixivBuildId,
  pixivBuildIdCacheByTask,
} from "@/src/site-integrations/pixiv-comic/shared"

describe("Pixiv build id cache bounds (PIXIV_BUILD_ID_CACHE_MAX_SIZE)", () => {
  beforeEach(() => {
    pixivBuildIdCacheByTask.clear()
  })

  afterEach(() => {
    pixivBuildIdCacheByTask.clear()
  })

  it("exposes a max size of 50 entries", () => {
    expect(PIXIV_BUILD_ID_CACHE_MAX_SIZE).toBe(50)
  })

  it("does not evict anything when inserting exactly 50 entries", () => {
    for (let i = 0; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    expect(pixivBuildIdCacheByTask.size).toBe(PIXIV_BUILD_ID_CACHE_MAX_SIZE)
    // First and last entries both retained — no eviction occurred.
    expect(pixivBuildIdCacheByTask.get("task-0")).toBe("build-0")
    expect(pixivBuildIdCacheByTask.get("task-49")).toBe("build-49")
  })

  it("evicts the oldest entry (FIFO) when inserting a 51st entry", () => {
    for (let i = 0; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    cachePixivBuildId("task-50", "build-50")

    expect(pixivBuildIdCacheByTask.size).toBe(PIXIV_BUILD_ID_CACHE_MAX_SIZE)
    // The first-inserted key was evicted.
    expect(pixivBuildIdCacheByTask.has("task-0")).toBe(false)
    // The new key is present.
    expect(pixivBuildIdCacheByTask.get("task-50")).toBe("build-50")
    // The second entry is now the oldest remaining.
    expect(pixivBuildIdCacheByTask.get("task-1")).toBe("build-1")
  })

  it("evicts entries in FIFO order across repeated overflow inserts", () => {
    for (let i = 0; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    // Insert 5 more — should evict task-0 through task-4 in order.
    for (let i = 50; i < 55; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    expect(pixivBuildIdCacheByTask.size).toBe(PIXIV_BUILD_ID_CACHE_MAX_SIZE)
    for (let i = 0; i < 5; i++) {
      expect(pixivBuildIdCacheByTask.has(`task-${i}`)).toBe(false)
    }
    expect(pixivBuildIdCacheByTask.get("task-5")).toBe("build-5")
    expect(pixivBuildIdCacheByTask.get("task-54")).toBe("build-54")
  })

  it("makes the evicted key non-retrievable while the new key is retrievable", () => {
    cachePixivBuildId("first", "build-first")
    for (let i = 1; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    cachePixivBuildId("overflow", "build-overflow")

    expect(pixivBuildIdCacheByTask.get("first")).toBeUndefined()
    expect(pixivBuildIdCacheByTask.get("overflow")).toBe("build-overflow")
  })

  it("updates an existing key in place without growing the cache (below capacity)", () => {
    for (let i = 0; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE - 1; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    const sizeBefore = pixivBuildIdCacheByTask.size
    cachePixivBuildId("task-25", "build-refreshed")

    expect(pixivBuildIdCacheByTask.size).toBe(sizeBefore)
    expect(pixivBuildIdCacheByTask.get("task-25")).toBe("build-refreshed")
    // Re-inserting an existing key must not evict the oldest entry.
    expect(pixivBuildIdCacheByTask.get("task-0")).toBe("build-0")
  })

  it("re-inserting the oldest key at full capacity updates its value without shrinking the cache", () => {
    for (let i = 0; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    // The oldest key is the FIFO eviction candidate, so re-inserting it
    // deletes-then-re-adds the same key: size stays at the cap and the value
    // is refreshed.
    cachePixivBuildId("task-0", "build-0-refreshed")

    expect(pixivBuildIdCacheByTask.size).toBe(PIXIV_BUILD_ID_CACHE_MAX_SIZE)
    expect(pixivBuildIdCacheByTask.get("task-0")).toBe("build-0-refreshed")
    expect(pixivBuildIdCacheByTask.get("task-49")).toBe("build-49")
  })

  // Re-inserting an existing key at full capacity should NOT evict the oldest
  // entry — the cache should stay at max size with the value updated in place.
  it("re-inserting a non-oldest existing key at full capacity does not evict the oldest entry", () => {
    for (let i = 0; i < PIXIV_BUILD_ID_CACHE_MAX_SIZE; i++) {
      cachePixivBuildId(`task-${i}`, `build-${i}`)
    }

    cachePixivBuildId("task-25", "build-25-refreshed")

    // The value is updated...
    expect(pixivBuildIdCacheByTask.get("task-25")).toBe("build-25-refreshed")
    // ...and the oldest entry is preserved (no eviction for existing keys).
    expect(pixivBuildIdCacheByTask.has("task-0")).toBe(true)
    expect(pixivBuildIdCacheByTask.size).toBe(PIXIV_BUILD_ID_CACHE_MAX_SIZE)
  })
})
