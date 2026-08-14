import { describe, expect, it } from "vitest"
import { resolveFileName } from "@/src/shared/template-resolver"
import { baseFileContext } from "./template-resolver-test-setup"

export function registerTemplateResolverFilenameAndPreviewCases(): void {
  describe("template-resolver", () => {
    describe("resolveFileName", () => {
      it("rejects an empty template", () => {
        const result = resolveFileName("", baseFileContext)
        expect(result.success).toBe(false)
        expect(result.error).toBe("Filename template is empty")
      })

      it("rejects an undefined template", () => {
        const result = resolveFileName(undefined, baseFileContext)
        expect(result.success).toBe(false)
        expect(result.error).toBe("Filename template is empty")
      })

      it("resolves template with chapter title macro", () => {
        const result = resolveFileName("<CHAPTER_TITLE>", baseFileContext)
        expect(result).toEqual({
          success: true,
          resolvedName: "Chapter 1001 - Big Moms Rage",
        })
      })

      it("resolves template with series and chapter", () => {
        const result = resolveFileName(
          "<SERIES_TITLE> - <CHAPTER_TITLE>",
          baseFileContext
        )
        expect(result).toEqual({
          success: true,
          resolvedName: "One Piece - Chapter 1001 - Big Moms Rage",
        })
      })

      it("resolves template with chapter number", () => {
        const result = resolveFileName(
          "Ch<CHAPTER_NUMBER_PAD3>",
          baseFileContext
        )
        expect(result).toEqual({ success: true, resolvedName: "Ch1001" })
      })

      it("sanitizes unsafe characters in filename", () => {
        const ctx = {
          ...baseFileContext,
          chapterTitle: "Chapter: 1 / Part * 2",
        }
        const result = resolveFileName("<CHAPTER_TITLE>", ctx)
        expect(result.success).toBe(true)
        expect(result.resolvedName).not.toContain(":")
        expect(result.resolvedName).not.toContain("/")
        expect(result.resolvedName).not.toContain("*")
      })

      it("rejects an invalid macro", () => {
        const result = resolveFileName("<INVALID_MACRO>", baseFileContext)
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Unknown or unimplemented macros/i)
      })

      it("rejects an expansion with no available value", () => {
        const result = resolveFileName("<PUBLISHER>", {
          ...baseFileContext,
          publisher: undefined,
        })
        expect(result.success).toBe(false)
        expect(result.error).toBe("Resolved filename is empty")
      })

      it("rejects an empty chapter-title expansion", () => {
        const result = resolveFileName("<CHAPTER_TITLE>", {
          ...baseFileContext,
          chapterTitle: "",
        })
        expect(result.success).toBe(false)
        expect(result.error).toBe("Resolved filename is empty")
      })

      it("trims whitespace from resolved filename", () => {
        const result = resolveFileName("  <CHAPTER_TITLE>  ", baseFileContext)
        expect(result).toEqual({
          success: true,
          resolvedName: "Chapter 1001 - Big Moms Rage",
        })
        expect(result.resolvedName).not.toMatch(/^\s|\s$/)
      })
    })
  })
}
