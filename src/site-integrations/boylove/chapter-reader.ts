import { BoyloveReaderPagesSchema } from "./contracts/reader"
import { assertDecodedImageWithinLimits } from "@/src/runtime/decoded-image-limits"
import { ProviderContractError } from "../provider-contract-error"
import { ChapterImagePlanSchema } from "../chapter-plan"
import { assertBoyloveImageUrl } from "./series-dom"

export type BoyloveImageLayout = {
  columns: number
  width: number
  height: number
}

function validateLayout(layout: BoyloveImageLayout): BoyloveImageLayout {
  assertDecodedImageWithinLimits(
    layout.width,
    Math.floor(layout.height),
    "BoyLove"
  )
  if (
    !Number.isInteger(layout.columns) ||
    layout.columns < 1 ||
    layout.columns > 256 ||
    layout.columns > layout.width ||
    !Number.isFinite(layout.height)
  ) {
    throw new ProviderContractError(
      "BoyLove reader reconstruction data is invalid."
    )
  }
  return layout
}

export function readBoyloveImageLayout(url: URL): BoyloveImageLayout {
  const match = url.hash.match(
    /^#boylove=(\d{1,3}),(\d{1,5}),(\d{1,5}(?:\.\d{1,20})?)$/
  )
  if (!match)
    throw new ProviderContractError(
      "BoyLove reader reconstruction data is missing."
    )
  return validateLayout({
    columns: Number(match[1]),
    width: Number(match[2]),
    height: Number(match[3]),
  })
}

function readReaderData(document: Document) {
  const scripts = Array.from(document.scripts).map(
    (script) => script.textContent ?? ""
  )
  const readerScript = scripts.find((script) =>
    /\bvar\s+imageData\s*=/.test(script)
  )
  const pagesText = readerScript?.match(
    /\bvar\s+imageData\s*=\s*(\[[\s\S]*?\])\s*;/
  )?.[1]
  const columnsText = readerScript?.match(
    /\bvar\s+randomClass\s*=\s*(\d+)\s*;/
  )?.[1]
  if (!pagesText || !columnsText)
    throw new ProviderContractError(
      "BoyLove chapter is unavailable or its reader data is missing."
    )
  let payload: unknown
  try {
    payload = JSON.parse(pagesText)
  } catch (error) {
    throw new ProviderContractError("BoyLove reader data is malformed.", error)
  }
  return {
    pages: BoyloveReaderPagesSchema.parse(payload),
    columns: Number(columnsText),
  }
}

type BoyloveReaderPage = ReturnType<
  typeof BoyloveReaderPagesSchema.parse
>[number]

function readPageUrl(
  page: BoyloveReaderPage,
  index: number,
  imageElement: Element,
  columns: number
): string {
  const sourceUrl = assertBoyloveImageUrl(page.src)
  const image = imageElement.querySelector("img")
  if (
    page.id !== index ||
    imageElement.getAttribute("data-page") !== String(index + 1) ||
    image?.getAttribute("data-original") !== page.src ||
    sourceUrl.hash
  ) {
    throw new ProviderContractError(
      "BoyLove reader page order or image source is inconsistent."
    )
  }
  const layout = validateLayout({
    columns,
    width: page.width,
    height: Number(page.height),
  })
  sourceUrl.hash = `boylove=${layout.columns},${layout.width},${layout.height}`
  return sourceUrl.href
}

export function parseBoyloveReader(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html")
  const { pages, columns } = readReaderData(document)
  const images = Array.from(
    document.querySelectorAll(
      ".reader-cartoon-chapter > .reader-cartoon-image[data-page]"
    )
  )
  if (pages.length !== images.length)
    throw new ProviderContractError("BoyLove reader page list is incomplete.")
  return ChapterImagePlanSchema.parse({
    imageUrls: pages.map((page, index) =>
      readPageUrl(page, index, images[index], columns)
    ),
  })
}
