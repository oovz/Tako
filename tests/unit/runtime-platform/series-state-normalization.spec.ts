import { describe, expect, it } from "vitest"
import {
  buildResolvedTabContext,
  normalizeFetchedSeriesData,
} from "@/src/runtime/series-data-normalization"
import {
  deriveVolumeStates,
  resolveVolumeStates,
} from "@/src/runtime/state-shapes"

describe("series normalization boundary", () => {
  it("retains valid chapter and volume fields while dropping malformed entries", () => {
    expect(
      normalizeFetchedSeriesData({
        chapters: [
          null,
          { url: " ", title: "bad" },
          {
            id: " c1 ",
            url: " https://example.test/c1 ",
            title: " First ",
            locked: true,
            chapterLabel: " Ch. 1 ",
            chapterNumber: 1,
            volumeId: " v1 ",
            volumeNumber: 2,
            volumeLabel: " Second ",
            language: " ja ",
          },
        ],
        volumes: [
          null,
          { id: " " },
          { id: " v1 ", title: " Second ", label: " Vol. 2 " },
        ],
      })
    ).toEqual({
      chapters: [
        {
          id: "c1",
          url: "https://example.test/c1",
          title: "First",
          locked: true,
          chapterLabel: "Ch. 1",
          chapterNumber: 1,
          volumeId: "v1",
          volumeNumber: 2,
          volumeLabel: "Second",
          language: "ja",
        },
      ],
      volumes: [{ id: "v1", title: "Second", label: "Vol. 2" }],
    })
  })

  it("accepts the chapter-array response and omits blank optional strings", () => {
    expect(
      normalizeFetchedSeriesData([
        { url: "https://example.test/1", title: "One", id: " " },
      ])
    ).toEqual({
      chapters: [
        { url: "https://example.test/1", title: "One", locked: false },
      ],
      volumes: [],
    })
    expect(normalizeFetchedSeriesData(undefined)).toEqual({
      chapters: [],
      volumes: [],
    })
  })

  it("uses the earliest volume label and sorts valid volume numbers", () => {
    expect(
      deriveVolumeStates([
        { volumeNumber: 2, volumeLabel: " Second ", index: 5 },
        { volumeNumber: Number.NaN, index: 0 },
        { volumeNumber: 1, volumeLabel: " ", index: 4 },
        { volumeNumber: 2, volumeLabel: "Later", index: 1 },
        { index: 2 },
      ])
    ).toEqual([
      { id: "volume-1", title: "Volume 1", label: "Volume 1" },
      { id: "volume-2", title: "Second", label: "Second" },
    ])
  })

  it("retains provider-defined volumes and derives missing volume projections", () => {
    const chapters = [{ volumeNumber: 2, index: 0 }]
    const volumes = [{ id: "provider-volume", title: "Custom" }]
    expect(resolveVolumeStates(chapters, volumes)).toBe(volumes)
    expect(resolveVolumeStates(chapters, [])).toEqual([
      { id: "volume-2", title: "Volume 2", label: "Volume 2" },
    ])
  })

  it("rejects unresolved identities and extraction failures before ready projection", () => {
    const input = {
      sourceUrl: "https://example.test/series",
      siteIntegrationId: "test",
      rawMangaId: " series ",
      chapters: [],
      seriesMetadata: { title: " Series " },
    }
    expect(buildResolvedTabContext({ ...input, rawMangaId: " " })).toEqual({
      context: "unsupported",
    })
    expect(
      buildResolvedTabContext({
        ...input,
        extractionError: new Error("unavailable"),
      })
    ).toEqual({ context: "error", error: "unavailable" })
    expect(
      buildResolvedTabContext({ ...input, extractionError: {} })
    ).toMatchObject({ context: "error" })
    expect(
      buildResolvedTabContext({ ...input, seriesMetadata: undefined })
    ).toMatchObject({ context: "error" })
    expect(
      buildResolvedTabContext({
        ...input,
        chapters: [{ url: "https://example.test/1", title: "One" }],
      })
    ).toMatchObject({ context: "error" })
    expect(buildResolvedTabContext(input)).toMatchObject({
      context: "ready",
      mangaId: "series",
      seriesTitle: "Series",
    })
  })
})
