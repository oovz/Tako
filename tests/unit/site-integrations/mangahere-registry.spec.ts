import { describe, expect, it } from "vitest"
import { matchUrl } from "@/src/site-integrations/url-matcher"

describe("mobile site registry URL recognition", () => {
  it.each(["newm.mangahere.cc"])(
    "recognizes MangaHere series on %s with either slash form",
    (host) => {
      for (const suffix of ["", "/"]) {
        expect(
          matchUrl(`https://${host}/manga/act_like_a_boss_mr_swallow${suffix}`)
        ).toEqual({ integrationId: "mangahere", role: "series" })
      }
    }
  )
  it.each(["newm.mangahere.cc"])(
    "excludes MangaHere reader pages on %s",
    (host) => {
      for (const path of [
        "c148",
        "c148/",
        "c148/1.html",
        "v01/c001/",
        "v01/c001/1.html",
        "comment",
      ]) {
        expect(
          matchUrl(`https://${host}/manga/act_like_a_boss_mr_swallow/${path}`)
        ).toBeNull()
      }
    }
  )
  it("does not recognize the unsupported legacy MangaHere host", () => {
    expect(matchUrl("https://m.mangahere.cc/manga/hunter_x_hunter/")).toBeNull()
    expect(
      matchUrl("https://m.mangahere.cc/manga/hunter_x_hunter/v01/c001/")
    ).toBeNull()
  })
  it("recognizes Aimanhua catalog pages and excludes its separate reader route", () => {
    for (const suffix of ["", "/"]) {
      expect(
        matchUrl(`https://www.aimanhua.org/comic/416895${suffix}`)
      ).toEqual({ integrationId: "lovemanga", role: "series" })
    }
    expect(
      matchUrl("https://www.aimanhua.org/chapter/416895/133632")
    ).toBeNull()
  })
})
