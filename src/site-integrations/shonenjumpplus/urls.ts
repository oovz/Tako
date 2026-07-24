const SITE_HOST = "shonenjumpplus.com"
const ASSET_HOSTS = new Set([
  "cdn-ak-img.shonenjumpplus.com",
  "cdn-ak.shonenjumpplus.com",
])

export interface TrustedEpisodeUrl {
  url: URL
  episodeId: string
}

export function parseTrustedShonenJumpPlusEpisodeUrl(
  input: string,
  base?: string
): TrustedEpisodeUrl | null {
  try {
    const url = base ? new URL(input, base) : new URL(input)
    const match = url.pathname.match(/^\/episode\/(\d+)\/?$/)
    if (
      url.protocol !== "https:" ||
      url.hostname !== SITE_HOST ||
      url.username ||
      url.password ||
      !match
    ) {
      return null
    }
    return { url, episodeId: match[1] }
  } catch {
    return null
  }
}

export function isTrustedShonenJumpPlusAssetUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ASSET_HOSTS.has(url.hostname)
    )
  } catch {
    return false
  }
}

export function isScrambledShonenJumpPlusPageUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      isTrustedShonenJumpPlusAssetUrl(input) &&
      url.hostname === "cdn-ak-img.shonenjumpplus.com" &&
      url.pathname.includes("/public/page/")
    )
  } catch {
    return false
  }
}
