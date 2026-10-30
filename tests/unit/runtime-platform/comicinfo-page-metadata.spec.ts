import { describe, expect, it } from "vitest"
import { generateComicInfo } from "@/src/runtime/comicinfo-generator"

describe("ComicInfo page metadata", () => {
  it("retains numeric zero and boolean false attributes and escapes textual attributes", () => {
    const xml = generateComicInfo(
      {
        Series: "Series & One",
        Pages: [
          {
            Image: 0,
            Type: "FrontCover",
            DoublePage: false,
            ImageSize: 0,
            Key: 'cover"key',
            Bookmark: "Chapter <One>",
            ImageWidth: 1200,
            ImageHeight: 1800,
          },
        ],
      },
      1
    )
    expect(xml).toContain("<Series>Series &amp; One</Series>")
    expect(xml).toContain(
      '<Page Image="0" Type="FrontCover" DoublePage="false" ImageSize="0" Key="cover&quot;key" Bookmark="Chapter &lt;One&gt;" ImageWidth="1200" ImageHeight="1800" />'
    )
  })
})
