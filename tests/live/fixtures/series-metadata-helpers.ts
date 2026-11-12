import { expect, type Page, type TestInfo } from "@playwright/test"
import type { LiveDownloadState } from "./download-workflow-helpers"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"

const contracts: Record<
  string,
  {
    language: string
    required: Array<"author" | "description" | "genres" | "year" | "publisher">
  }
> = {
  manganato: { language: "en", required: ["author", "description", "genres"] },
  mangakakalot: {
    language: "en",
    required: ["author", "description", "genres"],
  },
  animemangahouse: {
    language: "zh",
    required: ["author", "description", "genres"],
  },
  mangabz: { language: "zh", required: ["author", "description", "genres"] },
  boylove: { language: "zh", required: ["author", "description"] },
  mangago: {
    language: "en",
    required: ["author", "description", "genres"],
  },
  coolmic: { language: "en", required: ["author", "description", "genres"] },
  mangaplus: {
    language: "en",
    required: ["author", "description", "publisher"],
  },
  mangaagain: { language: "zh", required: ["author", "description", "genres"] },
  copymanga: { language: "zh", required: ["author", "description", "genres"] },
  mycomic: {
    language: "zh",
    required: ["author", "description", "genres", "year"],
  },
  mangahere: { language: "en", required: ["author", "description"] },
  lovemanga: { language: "zh", required: ["author", "description", "genres"] },
}

/** Compare background extraction with the independently loaded site document. */
export async function assertLiveSeriesMetadata(
  page: Page,
  state: LiveDownloadState,
  testInfo: TestInfo
): Promise<void> {
  const contract = contracts[state.siteIntegrationId]
  if (!contract) return
  const renderedSummary =
    state.siteIntegrationId === "mangaplus"
      ? '[class*="TitleDetailHeader-module_overview_"]'
      : state.siteIntegrationId === "mangaagain"
        ? ".comic_deCon_d"
        : undefined
  if (renderedSummary)
    await expect(page.locator(renderedSummary)).toContainText(/\S/)
  const source = await page.evaluate((id) => {
    const clean = (text: string | null | undefined) =>
      (text ?? "").replace(/\s+/g, " ").trim()
    const text = (selector: string) =>
      clean(document.querySelector(selector)?.textContent)
    const texts = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .map((node) => clean(node.textContent))
        .filter(Boolean)
    const unique = (values: string[]) => [...new Set(values)]
    const og =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") ?? ""
    const metadata: {
      title?: string
      author?: string
      genres?: string[]
      communityRating?: number
      publisher?: string
      readingDirection?: string
      year?: number
      description?: string
    } = {}
    let body = ""
    let chosenSource = "site API"
    switch (id) {
      case "manganato":
      case "mangakakalot": {
        metadata.title = text(".manga-info-text h1")
        const row = Array.from(
          document.querySelectorAll(".manga-info-text > li")
        ).find((node) => /^Author\(s\)\s*:/.test(clean(node.textContent)))
        metadata.author = clean(row?.textContent).replace(
          /^Author\(s\)\s*:\s*/,
          ""
        )
        metadata.genres = texts(".manga-info-text .genres a")
        metadata.communityRating = Number(
          document
            .querySelector(".manga-info-text .rating")
            ?.getAttribute("data-default")
        )
        const synopsis = document
          .querySelector("#contentBox")
          ?.cloneNode(true) as Element | undefined
        synopsis?.querySelector(":scope > h2")?.remove()
        synopsis?.querySelectorAll("br").forEach((br) => br.replaceWith(" "))
        const decoded = document.createElement("template")
        decoded.innerHTML = synopsis?.textContent ?? ""
        decoded.content
          .querySelectorAll("br")
          .forEach((br) => br.replaceWith(" "))
        body = clean(decoded.content.textContent)
        chosenSource = "#contentBox"
        break
      }
      case "animemangahouse":
      case "mangabz": {
        const dm5 = id === "animemangahouse"
        metadata.author = unique(
          texts(dm5 ? ".banner_detail_form .subtitle a" : ".detail-info-tip a")
        ).join(", ")
        metadata.genres = unique(
          texts(dm5 ? ".banner_detail_form .tip a" : ".detail-info-tip .item")
        )
        body = text(
          dm5 ? ".banner_detail_form .content" : ".detail-info-content"
        ).replace(/\[[+-](?:展开|展開|折叠|折疊)\]/g, "")
        chosenSource = "complete body with fold labels removed"
        break
      }
      case "boylove":
        metadata.author = text(".stui-content__detail .data i + a")
        body = clean(
          document.querySelector<HTMLElement>(
            ".stui-content__detail .detail-text"
          )?.innerText
        )
        chosenSource = body ? "rendered work synopsis" : "og:description"
        break
      case "mangago": {
        metadata.title = text("h1")
        const cells = Array.from(document.querySelectorAll(".manga_right td"))
        const author = cells.find(
          (cell) =>
            clean(cell.querySelector("label")?.textContent) === "Author:"
        )
        metadata.author = unique(
          Array.from(author?.querySelectorAll("a") ?? [])
            .map((node) => clean(node.textContent))
            .filter(Boolean)
        ).join(", ")
        metadata.genres = unique(texts('.manga_right a[href*="/genre/"]'))
        const score = text('.rating_wrap[rel="v:rating"] .rating_num')
        if (score) metadata.communityRating = Number(score) * 0.5
        const synopsis = document
          .querySelector(".manga_summary")
          ?.cloneNode(true) as Element | undefined
        synopsis
          ?.querySelectorAll(
            ":scope > .transform.comment_rname.expand, :scope > .transform.comment_rname.collapse"
          )
          .forEach((control) => control.remove())
        body = clean(synopsis?.textContent)
        chosenSource = ".manga_summary"
        break
      }
      case "coolmic": {
        const raw = document
          .querySelector("title-page")
          ?.getAttribute(":page-objects")
        if (!raw) throw new Error("Missing live Coolmic bootstrap")
        const { title } = JSON.parse(raw) as {
          title: {
            name: string
            summary: string
            artists: Array<{ name: string }>
            genres: Array<{ name: string }>
            agency?: string
            contents_image_type?: string
          }
        }
        metadata.title = title.name
        metadata.author = title.artists.map((artist) => artist.name).join(", ")
        metadata.genres = title.genres.map((genre) => genre.name)
        if (title.agency) metadata.publisher = title.agency
        if (title.contents_image_type === "vertical")
          metadata.readingDirection = "vertical"
        body = title.summary
        chosenSource = "website title bootstrap summary"
        break
      }
      case "copymanga":
        metadata.title = text(".comicParticulars-title h6")
        metadata.author = unique(
          texts('.comicParticulars-title a[href^="/author/"]')
        ).join(", ")
        metadata.genres = texts(".comicParticulars-tag a").map((value) =>
          value.replace(/^#/, "")
        )
        body = text(".intro")
        chosenSource = ".intro"
        break
      case "mycomic": {
        const labels = Array.from(document.querySelectorAll("label"))
        const field = (label: string) => {
          const matching = labels.find(
            (node) => clean(node.textContent) === label
          )
          return Array.from(
            matching?.nextElementSibling?.querySelectorAll("a") ?? []
          )
            .map((node) => clean(node.textContent))
            .filter(Boolean)
        }
        metadata.author = field("原创作者:").join(", ")
        metadata.genres = field("作品类型:")
        const year = clean(
          Array.from(document.querySelectorAll("h1, h2, p, div")).find((node) =>
            /^\d{4}\s*\/\s*共\s*\d+\s*话$/.test(clean(node.textContent))
          )?.textContent
        ).match(/^\d{4}/)?.[0]
        metadata.year = year ? Number(year) : undefined
        chosenSource = "og:description"
        break
      }
      case "mangaplus":
        metadata.title = text('[class*="TitleDetailHeader-module_title_"]')
        metadata.author = text('[class*="TitleDetailHeader-module_author_"]')
        body = text('[class*="TitleDetailHeader-module_overview_"]')
        chosenSource = "rendered official title synopsis"
        break
      case "mangaagain": {
        metadata.title = text(".comic_deCon h1")
        const rows = texts(".comic_deCon .comic_info_1 > div")
        metadata.author = rows
          .find((value) => /^作者[：:]/.test(value))
          ?.replace(/^作者[：:]\s*/, "")
        metadata.genres = rows
          .find((value) => /^类型[：:]/.test(value))
          ?.replace(/^类型[：:]\s*/, "")
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean)
        const category = rows
          .find((value) => /^类别[：:]/.test(value))
          ?.replace(/^类别[：:]\s*/, "")
        if (category && metadata.genres && !metadata.genres.includes(category))
          metadata.genres.push(category)
        body = text(".comic_deCon_d")
        chosenSource = "rendered official work synopsis"
        break
      }
      case "mangahere":
        metadata.author = texts(".detail-author-bar a").join(", ")
        metadata.genres = texts(".detail-tag-bar a")
        metadata.communityRating = Number(
          text(".detail-top-bar-info-star span")
        )
        body = text(".detail-text-bar .fullcontent")
        chosenSource = ".detail-text-bar .fullcontent"
        break
      case "lovemanga": {
        const author = Array.from(
          document.querySelectorAll(".detail-main-info-author")
        ).find((node) => /^作者[：:]/.test(clean(node.textContent)))
        metadata.author = clean(author?.textContent).replace(
          /^作者[：:]\s*/,
          ""
        )
        metadata.genres = texts(".detail-main-info-class a")
        body = text(".detail-desc")
        chosenSource = ".detail-desc"
        break
      }
    }
    metadata.description = clean(chosenSource === "og:description" ? og : body)
    return {
      metadata,
      description: { chosenSource, body, openGraph: clean(og) },
    }
  }, state.siteIntegrationId)

  await testInfo.attach("series-metadata-comparison.json", {
    body: JSON.stringify(
      {
        integrationId: state.siteIntegrationId,
        workUrl: page.url(),
        extracted: state.metadata,
        source,
      },
      null,
      2
    ),
    contentType: "application/json",
  })
  expect(state.metadata?.language).toBe(contract.language)
  if (state.siteIntegrationId === "mangago")
    expect(state.metadata?.year).toBeUndefined()
  for (const field of contract.required) {
    const value = state.metadata?.[field]
    if (Array.isArray(value)) {
      expect(value.length, field).toBeGreaterThan(0)
      for (const item of value) expect(item.trim(), field).not.toBe("")
    } else if (typeof value === "number") {
      expect(value, field).toBeGreaterThan(0)
    } else {
      expect(typeof value, field).toBe("string")
      expect(value?.trim(), field).not.toBe("")
    }
  }
  for (const [field, expected] of Object.entries(source.metadata)) {
    expect(expected, `live source ${field}`).toBeTruthy()
    const extracted =
      field === "title"
        ? state.seriesTitle
        : state.metadata?.[field as keyof SeriesMetadataSnapshot]
    expect(
      typeof extracted === "string"
        ? extracted.replace(/\s+/g, " ").trim()
        : extracted,
      field
    ).toEqual(expected)
  }
  expect(state.metadata?.description).not.toMatch(
    /\[[+-](?:展开|展開|折叠|折疊)\]/
  )
}
