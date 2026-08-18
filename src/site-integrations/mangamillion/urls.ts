export const MANGAMILLION_HOST = "mangamillion.shueisha.co.jp"
export const MANGAMILLION_API_HOST = "api.mangamillion.shueisha.co.jp"
export const MANGAMILLION_IMG_HOST = "img.mangamillion.shueisha.co.jp"

export const MANGAMILLION_ORIGIN = `https://${MANGAMILLION_HOST}`
export const MANGAMILLION_API_ORIGIN = `https://${MANGAMILLION_API_HOST}`
export const MANGAMILLION_IMG_ORIGIN = `https://${MANGAMILLION_IMG_HOST}`

export interface ParsedMangaMillionUrl {
  titleId: number
  language: string
  chapterId?: number
}

const TITLE_URL_REGEX =
  /^(?:\/([a-zA-Z]{2}(?:-[a-zA-Z]{2,4})?))?\/title\/(\d+)(?:\/chapter\/(\d+))?\/?$/

export function parseMangaMillionSeriesUrl(
  input: string
): ParsedMangaMillionUrl | null {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return null
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== MANGAMILLION_HOST ||
    parsed.username ||
    parsed.password
  ) {
    return null
  }

  const match = TITLE_URL_REGEX.exec(parsed.pathname)
  if (!match) {
    return null
  }

  const language = match[1] || "en"
  const titleId = Number.parseInt(match[2], 10)
  const chapterId = match[3] ? Number.parseInt(match[3], 10) : undefined

  if (!Number.isSafeInteger(titleId) || titleId <= 0) {
    return null
  }

  return {
    titleId,
    language,
    ...(chapterId !== undefined &&
    Number.isSafeInteger(chapterId) &&
    chapterId > 0
      ? { chapterId }
      : {}),
  }
}

export function parseMangaMillionChapterId(
  input: string | number
): number | null {
  if (typeof input === "number") {
    return Number.isSafeInteger(input) && input > 0 ? input : null
  }

  const parsedNumber = Number.parseInt(input, 10)
  if (
    Number.isSafeInteger(parsedNumber) &&
    parsedNumber > 0 &&
    String(parsedNumber) === input.trim()
  ) {
    return parsedNumber
  }

  const parsedUrl = parseMangaMillionSeriesUrl(input)
  if (parsedUrl?.chapterId) {
    return parsedUrl.chapterId
  }

  return null
}

export function buildMangaMillionChapterUrl(
  titleId: number | string,
  chapterId: number | string,
  language = "en"
): string {
  return `${MANGAMILLION_ORIGIN}/${language}/title/${titleId}/chapter/${chapterId}`
}

export function isTrustedMangaMillionAssetUrl(input: string): boolean {
  try {
    const parsed = new URL(input)
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === MANGAMILLION_IMG_HOST &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

export function isTrustedMangaMillionApiUrl(input: string): boolean {
  try {
    const parsed = new URL(input)
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === MANGAMILLION_API_HOST &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}
