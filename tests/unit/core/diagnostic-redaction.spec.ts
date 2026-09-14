import { describe, expect, it } from "vitest"

import {
  REDACTED_DIAGNOSTIC_VALUE,
  redactDiagnostic,
  redactDiagnosticText,
} from "@/src/runtime/diagnostic-redaction"

const SECRET = "SYNTHETIC_DIAGNOSTIC_SECRET_MARKER"

describe("diagnostic redaction", () => {
  it("removes URL userinfo as well as query and fragment values", () => {
    const redacted = redactDiagnosticText(
      `Request https://diagnostic-user:${SECRET}@provider.example/page.png?token=${SECRET}#${SECRET}`
    )

    expect(redacted).toContain("https://provider.example/page.png")
    expect(redacted).not.toContain("diagnostic-user")
    expect(redacted).not.toContain(SECRET)
  })

  it("removes URL query and fragment values and local paths from text", () => {
    const redacted = redactDiagnosticText(
      `Request https://provider.example/chapter/page.png?token=${SECRET}#${SECRET} failed at C:\\Users\\test-user\\${SECRET}\\image.png`
    )

    expect(redacted).toContain("https://provider.example/chapter/page.png")
    expect(redacted).toContain("[REDACTED_PATH]")
    expect(redacted).not.toContain(SECRET)
    expect(redacted).not.toContain("?")
    expect(redacted).not.toContain("#")
  })

  it("redacts nested errors, causes, context, and headers", () => {
    const cause = new Error(
      `cause https://provider.example/cause?token=${SECRET}`
    )
    const error = new Error(
      `request https://provider.example/api?token=${SECRET}`,
      { cause }
    )
    const value = {
      error,
      context: {
        url: `https://provider.example/series?session=${SECRET}`,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "content-type": "image/png",
          "x-provider-session": SECRET,
        },
        token: SECRET,
        responseBody: `{"access_token":"${SECRET}"}`,
        html: `<input value="${SECRET}">`,
        path: `C:\\Users\\test-user\\${SECRET}\\output.cbz`,
      },
    }

    const redacted = redactDiagnostic(value)
    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain(SECRET)
    expect(redacted).toMatchObject({
      context: {
        headers: {
          Authorization: REDACTED_DIAGNOSTIC_VALUE,
          "content-type": "image/png",
          "x-provider-session": REDACTED_DIAGNOSTIC_VALUE,
        },
        token: REDACTED_DIAGNOSTIC_VALUE,
        responseBody: REDACTED_DIAGNOSTIC_VALUE,
        html: REDACTED_DIAGNOSTIC_VALUE,
        path: REDACTED_DIAGNOSTIC_VALUE,
      },
    })
    expect((redacted as { error: { cause: unknown } }).error.cause).toEqual(
      expect.objectContaining({ message: expect.not.stringContaining(SECRET) })
    )
  })

  it("redacts tuple and unsupported string header representations", () => {
    const redacted = redactDiagnostic({
      headers: [
        ["Authorization", `Bearer ${SECRET}`],
        ["content-type", "image/png"],
        ["x-provider-session", SECRET],
      ],
      rawHeaders: `Authorization: Bearer ${SECRET}`,
    })

    expect(redacted).toEqual({
      headers: [
        ["Authorization", REDACTED_DIAGNOSTIC_VALUE],
        ["content-type", "image/png"],
        ["x-provider-session", REDACTED_DIAGNOSTIC_VALUE],
      ],
      rawHeaders: REDACTED_DIAGNOSTIC_VALUE,
    })
    expect(JSON.stringify(redacted)).not.toContain(SECRET)
  })

  it("redacts header-shaped fields attached to an Error", () => {
    const error = new Error("request failed")
    Object.defineProperty(error, "rawHeaders", {
      enumerable: true,
      value: `Authorization: Bearer ${SECRET}`,
    })

    const redacted = redactDiagnostic(error) as { rawHeaders: unknown }

    expect(redacted.rawHeaders).toBe(REDACTED_DIAGNOSTIC_VALUE)
    expect(JSON.stringify(redacted)).not.toContain(SECRET)
  })

  it("fails closed for malformed credentialed URL tokens", () => {
    const redacted = redactDiagnosticText(
      `Request https://diagnostic-user:${SECRET}@provider.example:invalid/page?token=${SECRET}`
    )

    expect(redacted).toContain(REDACTED_DIAGNOSTIC_VALUE)
    expect(redacted).not.toContain(SECRET)
    expect(redacted).not.toContain("diagnostic-user")
  })

  it("bounds distinct nested Error causes", () => {
    let error: Error = new Error("leaf")
    for (let index = 0; index < 1_000; index += 1) {
      error = new Error(`cause-${index}`, { cause: error })
    }

    const redacted = redactDiagnostic(error)

    expect(JSON.stringify(redacted)).toContain(REDACTED_DIAGNOSTIC_VALUE)
  })

  it("bounds enumerable Error properties", () => {
    const error = new Error("request failed")
    for (let index = 0; index < 150; index += 1) {
      Object.defineProperty(error, `property${index}`, {
        enumerable: true,
        value: index,
      })
    }

    const redacted = redactDiagnostic(error) as Record<string, unknown>

    expect(redacted).toHaveProperty("property0")
    expect(redacted).not.toHaveProperty("property100")
  })

  it("handles cyclic diagnostic context without exposing values", () => {
    const value: { message: string; self?: unknown } = {
      message: `https://provider.example/path?token=${SECRET}`,
    }
    value.self = value

    const redacted = redactDiagnostic(value)

    expect(JSON.stringify(redacted)).not.toContain(SECRET)
    expect(redacted).toEqual({
      message: "https://provider.example/path",
      self: "[Circular]",
    })
  })

  it("does not inspect beyond the bounded header-list prefix", () => {
    let outOfBudgetReads = 0
    const entries: unknown[] = Array.from({ length: 101 }, () => [
      "content-type",
      "text/plain",
    ])
    Object.defineProperty(entries, 100, {
      configurable: true,
      get: () => {
        outOfBudgetReads += 1
        return ["authorization", SECRET]
      },
    })

    expect(() => redactDiagnostic(entries)).not.toThrow()
    expect(redactDiagnostic(entries)).toHaveLength(100)
    expect(outOfBudgetReads).toBe(0)
  })

  it("bounds ordinary arrays independently from header-list classification", () => {
    let outOfBudgetReads = 0
    const values: unknown[] = Array.from({ length: 101 }, (_, index) => index)
    Object.defineProperty(values, 100, {
      configurable: true,
      get: () => {
        outOfBudgetReads += 1
        return SECRET
      },
    })

    expect(redactDiagnostic(values)).toHaveLength(100)
    expect(outOfBudgetReads).toBe(0)
  })

  it("contains unreadable header tuple cells at every supported boundary", () => {
    const makeUnreadablePair = (index: 0 | 1): unknown[] => {
      const pair: unknown[] = ["x-provider-session", SECRET]
      Object.defineProperty(pair, index, {
        configurable: true,
        get: () => {
          throw new Error("unreadable retained tuple cell")
        },
      })
      return pair
    }

    const topLevel = makeUnreadablePair(0)
    const wrapped = { headers: [makeUnreadablePair(1)] }
    const mixed = [makeUnreadablePair(0), { stage: "fetch" }]
    const headerObject: Record<string, unknown> = {}
    Object.defineProperty(headerObject, "x-provider-session", {
      enumerable: true,
      get: () => {
        throw new Error("unreadable header object value")
      },
    })
    const wrappedObject = { headers: headerObject }

    expect(() => redactDiagnostic(topLevel)).not.toThrow()
    expect(() => redactDiagnostic(wrapped)).not.toThrow()
    expect(() => redactDiagnostic(mixed)).not.toThrow()
    expect(() => redactDiagnostic(wrappedObject)).not.toThrow()
    expect(redactDiagnostic(topLevel)).toBe("[Unreadable]")
    expect(JSON.stringify(redactDiagnostic(wrapped))).not.toContain(SECRET)
    expect(JSON.stringify(redactDiagnostic(mixed))).not.toContain(SECRET)
    expect(JSON.stringify(redactDiagnostic(wrappedObject))).not.toContain(
      SECRET
    )

    const safe = redactDiagnostic({
      headers: [["content-type", "image/png"]],
    })
    expect(safe).toEqual({ headers: [["content-type", "image/png"]] })
  })
})
