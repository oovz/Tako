import { afterEach, expect, it, vi } from "vitest"
import { pageProbe } from "@/src/site-integrations/mangadex/probe"

const url = "https://mangadex.org/title/series"
afterEach(() => vi.unstubAllGlobals())

function collect(raw: string | null) {
  vi.stubGlobal("location", { href: url })
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => raw) })
  const serializedCollect = new Function(
    `return (${pageProbe.collect.toString()})()`
  ) as () => unknown
  const collected = pageProbe.collect()
  expect(serializedCollect()).toEqual(collected)
  return pageProbe.parse(collected)
}

it.each([
  { userPreferences: { dataSaver: false }, settings: { dataSaver: true } },
  { userPreferences: [], settings: { dataSaver: false } },
  { dataSaver: false },
])(
  "reads the first available settings record from its serialized probe",
  (stored) => {
    expect(collect(JSON.stringify(stored))).toEqual({
      url,
      data: { dataSaver: false },
    })
  }
)

it.each([null, "{", "[]", "null", "3", "{}"])(
  "tolerates absent, invalid, or unrelated optional storage",
  (raw) => {
    expect(collect(raw)).toEqual({ url })
  }
)

it("bounds language counts and lengths and keeps boolean preferences only", () => {
  const raw = {
    userPreferences: {
      showSafe: true,
      showHentai: false,
      dataSaver: "false",
      filteredLanguages: [
        1,
        "x".repeat(33),
        ...Array.from({ length: 40 }, (_, index) => String(index)),
      ],
    },
  }
  expect(collect(JSON.stringify(raw))).toEqual({
    url,
    data: {
      showSafe: true,
      showHentai: false,
      filteredLanguages: Array.from({ length: 32 }, (_, index) =>
        String(index)
      ),
    },
  })
})

it("returns the URL when website storage is inaccessible", () => {
  vi.stubGlobal("location", { href: url })
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("denied")
    },
  })
  expect(pageProbe.collect()).toEqual({ url })
})
