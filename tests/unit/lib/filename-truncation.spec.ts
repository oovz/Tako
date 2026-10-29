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

  it("removes an incomplete supplementary character at the length limit", () => {
    const prefix = "a".repeat(MAX_FILENAME_LENGTH - 1)
    const result = sanitizeFilename(`${prefix}📚chapter`)
    assert.equal(result, prefix)
    assert.equal(sanitizeFilename(result), result)
  })

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

  it("preserves ordinary names and the existing ASCII length limit", () => {
    assert.equal(sanitizeFilename("第1話 - Chapter 📚"), "第1話 - Chapter 📚")
    assert.equal(
      sanitizeFilename("a".repeat(MAX_FILENAME_LENGTH + 1)),
      "a".repeat(MAX_FILENAME_LENGTH)
    )
    assert.equal(sanitizeFilename("CON.txt"), "_")
  })
})
