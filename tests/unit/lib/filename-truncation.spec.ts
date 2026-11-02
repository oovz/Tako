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

for (const character of ["漫", "あ", "한", "é", "📚"]) {
  it(`fits a long ${character} title within a filesystem name`, () => {
    const input = character.repeat(200)
    const result = sanitizeFilename(input)
    assert.ok(Buffer.byteLength(`${result}.cbz`, "utf8") <= 255)
    assert.ok(result.length <= MAX_FILENAME_LENGTH)
    assert.ok(input.startsWith(result))
    assert.equal(sanitizeFilename(result), result)
  })
}

it("keeps complete characters when the UTF-8 byte limit is reached", () => {
  const input = `${"漫".repeat(79)}📚chapter`
  const result = sanitizeFilename(input)
  assert.equal(result, "漫".repeat(79))
  assert.equal(sanitizeFilename(result), result)
})

for (const device of ["COM¹", "com²", "COM³", "LPT¹", "lpt²", "LPT³"]) {
  it(`replaces Windows device name ${device}, including extensions`, () => {
    assert.equal(sanitizeFilename(device), "_")
    assert.equal(sanitizeFilename(`${device}.cbz`), "_")
  })
}

it("preserves similar names that are not Windows devices", () => {
  assert.equal(sanitizeFilename("COM⁴"), "COM⁴")
  assert.equal(sanitizeFilename("LPT¹2"), "LPT¹2")
})
