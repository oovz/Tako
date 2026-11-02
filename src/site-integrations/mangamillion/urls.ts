export const MANGAMILLION_HOST = "mangamillion.shueisha.co.jp"
export const MANGAMILLION_API_HOST = "api.mangamillion.shueisha.co.jp"
export const MANGAMILLION_IMG_HOST = "img.mangamillion.shueisha.co.jp"

export const MANGAMILLION_ORIGIN = `https://${MANGAMILLION_HOST}`
export const MANGAMILLION_API_ORIGIN = `https://${MANGAMILLION_API_HOST}`

export interface ParsedMangaMillionUrl {
  titleId: number
  language: string
  chapterId?: number
}

const TITLE_URL_REGEX =
  /^(?:\/([a-zA-Z0-9_-]+))?\/title\/(\d+)(?:\/chapter\/(\d+))?\/?$/

function parseTrustedMangaMillionUrl(
  input: string,
  hostname: string
): URL | null {
  try {
    const parsed = new URL(input)
    return parsed.protocol === "https:" &&
      parsed.hostname === hostname &&
      !parsed.username &&
      !parsed.password
      ? parsed
      : null
  } catch {
    return null
  }
}

function positiveInteger(value: number): number | undefined {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function parseMangaMillionSeriesUrl(
  input: string
): ParsedMangaMillionUrl | null {
  const parsed = parseTrustedMangaMillionUrl(input, MANGAMILLION_HOST)
  if (!parsed) return null

  const match = TITLE_URL_REGEX.exec(parsed.pathname)
  if (!match) {
    return null
  }

  const queryLang = parsed.searchParams.get("lang")?.trim()
  const language = queryLang || match[1] || "en"
  const titleId = Number.parseInt(match[2], 10)
  const chapterId = positiveInteger(Number.parseInt(match[3], 10))

  if (!positiveInteger(titleId)) {
    return null
  }

  return {
    titleId,
    language,
    ...(chapterId !== undefined ? { chapterId } : {}),
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
  return parseTrustedMangaMillionUrl(input, MANGAMILLION_IMG_HOST) !== null
}

export function isTrustedMangaMillionApiUrl(input: string): boolean {
  return parseTrustedMangaMillionUrl(input, MANGAMILLION_API_HOST) !== null
}
