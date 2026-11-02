import { describe, expect, it } from "vitest"
import {
  redactDiagnostic,
  redactDiagnosticText,
  REDACTED_DIAGNOSTIC_VALUE,
} from "@/src/runtime/diagnostic-redaction"

describe("diagnostic value boundaries", () => {
  it("keeps safe native header values and conceals credentials and unsupported containers", () => {
    const headers = new Headers({
      "content-type": "image/png",
      authorization: "secret",
    })
    expect(redactDiagnostic({ headers })).toEqual({
      headers: {
        "content-type": "image/png",
        authorization: REDACTED_DIAGNOSTIC_VALUE,
      },
    })
    expect(
      redactDiagnostic({ headers: new Map([["authorization", "secret"]]) })
    ).toEqual({ headers: REDACTED_DIAGNOSTIC_VALUE })
    expect(
      redactDiagnostic({
        headers: null,
        requestHeaders: 1,
        responseHeaders: [["invalid"]],
      })
    ).toEqual({
      headers: REDACTED_DIAGNOSTIC_VALUE,
      requestHeaders: REDACTED_DIAGNOSTIC_VALUE,
      responseHeaders: REDACTED_DIAGNOSTIC_VALUE,
    })
  })

  it("redacts serialized diagnostics recursively and rejects malformed dumps", () => {
    expect(
      JSON.parse(redactDiagnostic('{"token":"secret","status":200}') as string)
    ).toEqual({ token: REDACTED_DIAGNOSTIC_VALUE, status: 200 })
    expect(redactDiagnostic('{"token":"secret"')).toBe(
      REDACTED_DIAGNOSTIC_VALUE
    )
    expect(redactDiagnostic("x".repeat(2001))).toBe(REDACTED_DIAGNOSTIC_VALUE)
  })

  it("formats structured and missing diagnostics without leaking sensitive fields", () => {
    expect(
      JSON.parse(redactDiagnosticText({ status: 200, token: "secret" }))
    ).toEqual({ status: 200, token: REDACTED_DIAGNOSTIC_VALUE })
    expect(redactDiagnosticText(undefined)).toBe("undefined")
    expect(redactDiagnostic([])).toEqual([])
  })

  it("handles URLs, opaque values and non-JSON primitives without exposing raw data", () => {
    expect(
      redactDiagnostic(new URL("https://example.test/image?secret=1"))
    ).toBe("https://example.test/image")
    expect(redactDiagnostic(new URLSearchParams("secret=1"))).toBe(
      REDACTED_DIAGNOSTIC_VALUE
    )
    expect(redactDiagnostic(new Set(["secret"]))).toBe(
      REDACTED_DIAGNOSTIC_VALUE
    )
    expect(redactDiagnostic(new Uint8Array([1, 2]))).toBe(
      "[Binary diagnostic omitted]"
    )
    expect(
      redactDiagnostic([1n, Symbol("secret"), () => "secret", true, null])
    ).toEqual(["[BigInt]", "[Symbol]", "[Function]", true, null])
  })
})
