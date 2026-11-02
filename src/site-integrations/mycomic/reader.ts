import { ChapterImagePlanSchema } from "../chapter-plan"
import { ProviderContractError } from "../provider-contract-error"
import { assertMyComicImageUrl } from "./shared"

export function parseMyComicChapterImages(
  document: Document,
  chapterId: string
): string[] {
  const images = [...document.querySelectorAll('img.page[x-ref^="page-"]')]
  const imageUrls = images.map((image, index) => {
    if (image.getAttribute("x-ref") !== `page-${index + 1}`)
      throw new ProviderContractError(
        "MyComic reader is missing a required page"
      )
    const source =
      image.getAttribute("data-src") || image.getAttribute("src") || ""
    assertMyComicImageUrl(source)
    if (
      !new URL(source).pathname.startsWith(
        `/chapters/${chapterId}/${index + 1}-`
      )
    )
      throw new ProviderContractError(
        "MyComic reader page does not match the selected chapter"
      )
    return source
  })
  const selectors = document.querySelectorAll('[x-ref^="page-selector-"]')
  if (selectors.length && selectors.length !== images.length)
    throw new ProviderContractError("MyComic reader page count is incomplete")
  return ChapterImagePlanSchema.parse({ imageUrls }).imageUrls
}
