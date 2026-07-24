import { describe, expect, it } from "vitest"
import {
  allowsDeterministicE2eRedirect,
  isDeterministicE2eMockResponseUrl,
  shouldAcceptDeterministicE2eMockResponse,
} from "@/src/runtime/deterministic-e2e-redirect"

describe("deterministic E2E redirect guard", () => {
  it("recognizes only explicit loopback HTTP mock-server URLs", () => {
    expect(
      isDeterministicE2eMockResponseUrl("http://127.0.0.1:39123/mock")
    ).toBe(true)
    expect(
      isDeterministicE2eMockResponseUrl("http://localhost:39123/mock")
    ).toBe(true)

    expect(
      isDeterministicE2eMockResponseUrl("https://127.0.0.1:39123/mock")
    ).toBe(false)
    expect(isDeterministicE2eMockResponseUrl("http://127.0.0.1/mock")).toBe(
      false
    )
    expect(
      isDeterministicE2eMockResponseUrl("http://attacker.example:39123/mock")
    ).toBe(false)
    expect(isDeterministicE2eMockResponseUrl("not a URL")).toBe(false)
  })

  it("requires both the test-build flag and an approved loopback response", () => {
    const loopbackResponse = "http://127.0.0.1:39123/mock"

    expect(shouldAcceptDeterministicE2eMockResponse(undefined)).toBe(false)
    expect(
      shouldAcceptDeterministicE2eMockResponse("https://attacker.example/mock")
    ).toBe(false)
    expect(shouldAcceptDeterministicE2eMockResponse(loopbackResponse)).toBe(
      allowsDeterministicE2eRedirect
    )
  })
})
