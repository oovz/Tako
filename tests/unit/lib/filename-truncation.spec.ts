import assert from "node:assert/strict"
import { describe, it } from "vitest"
import {
  MAX_FILENAME_LENGTH,
  sanitizeFilename,
} from "@/src/shared/filename-sanitizer"

describe("filename truncation", () => {
  for (const suffix of [".", " "]) {
    it(`sanitizes ${JSON.stringify(suffix)} exposed at the length limit`, () => {
      const prefix = "a".repeat(MAX_FILENAME_LENGTH - 1)
      const result = sanitizeFilename(`${prefix}${suffix}chapter`)
      assert.equal(result, `${prefix}_`)
      assert.equal(sanitizeFilename(result), result)
    })
  }

  it.each(["📚", "\u{10000}", "\u{10ffff}"])(
    "removes incomplete character %s at the length limit",
    (character) => {
      const prefix = "a".repeat(MAX_FILENAME_LENGTH - 1)
      const result = sanitizeFilename(`${prefix}${character}chapter`)
      assert.equal(result, prefix)
      assert.equal(sanitizeFilename(result), result)
    }
  )

  it("sanitizes a suffix exposed by removing an incomplete character", () => {
    const prefix = "a".repeat(MAX_FILENAME_LENGTH - 2)
    const result = sanitizeFilename(`${prefix}.📚chapter`)
    assert.equal(result, `${prefix}_`)
    assert.equal(sanitizeFilename(result), result)
  })

  it("preserves complete supplementary characters at the length limit", () => {
    const expected = `${"a".repeat(MAX_FILENAME_LENGTH - 2)}📚`
    assert.equal(sanitizeFilename(`${expected}chapter`), expected)
    assert.equal(sanitizeFilename(expected), expected)
  })
})
