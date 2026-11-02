import { ProviderContractError } from "../provider-contract-error"

export const MYCOMIC_ORIGIN = "https://mycomic.com"

export function parseMyComicUrl(
  value: string,
  kind: "comics" | "chapters"
): { url: URL; id: string; prefix: string } {
  const url = new URL(value)
  const match = url.pathname.match(/^\/(cn\/)?(comics|chapters)\/(\d+)\/?$/)
  if (
    url.origin !== MYCOMIC_ORIGIN ||
    url.username ||
    url.password ||
    !match ||
    match[2] !== kind
  ) {
    throw new ProviderContractError(`Invalid MyComic ${kind} URL`)
  }
  return { url, id: match[3], prefix: match[1] ? "/cn" : "" }
}

export function assertMyComicImageUrl(value: string): void {
  const url = new URL(value)
  if (
    url.origin !== "https://biccam.com" ||
    url.username ||
    url.password ||
    !/^\/(chapters\/\d+\/\d+-[a-zA-Z0-9]+\.(?:jpe?g|png|webp)|comics\/\d+-[a-zA-Z0-9]+\.(?:jpe?g|png|webp))$/.test(
      url.pathname
    )
  ) {
    throw new ProviderContractError(
      "MyComic returned an unsupported content image URL"
    )
  }
}
