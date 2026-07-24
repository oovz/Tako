import { describe, expect, it } from "vitest"

import { shouldBlockUnmatchedRequest } from "@/tests/e2e/fixtures/routes"

describe("mocked E2E route policy", () => {
  it("blocks unmatched HTTP requests when live network is disabled", () => {
    expect(
      shouldBlockUnmatchedRequest("https://unmatched.example/api", false)
    ).toBe(true)
    expect(
      shouldBlockUnmatchedRequest("http://127.0.0.1:1234/unmatched", false)
    ).toBe(true)
  })

  it("allows only the exact local mock-server origin", () => {
    const allowedOrigins = ["http://127.0.0.1:49152"]
    expect(
      shouldBlockUnmatchedRequest(
        "http://127.0.0.1:49152/mangadex/api",
        false,
        allowedOrigins
      )
    ).toBe(false)
    expect(
      shouldBlockUnmatchedRequest(
        "http://127.0.0.1:49153/mangadex/api",
        false,
        allowedOrigins
      )
    ).toBe(true)
  })

  it("allows extension resources and explicitly enabled live network", () => {
    expect(
      shouldBlockUnmatchedRequest("chrome-extension://id/sidepanel.html", false)
    ).toBe(false)
    expect(
      shouldBlockUnmatchedRequest("https://api.mangadex.org/manga/id", true)
    ).toBe(false)
  })
})
