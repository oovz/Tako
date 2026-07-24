export function parseWorkId(pathname: string): string | null {
  const match = pathname.match(/^\/works\/(\d+)\/?$/)
  return match ? match[1] : null
}

export function parseWorkIdFromUrl(url: string): string | null {
  try {
    return parseWorkId(new URL(url).pathname)
  } catch {
    return null
  }
}

export function parseEpisodeIdFromUrl(chapterUrl: string): string | null {
  let url: URL
  try {
    url = new URL(chapterUrl)
  } catch {
    return null
  }
  if (url.origin !== "https://comic.pixiv.net") {
    return null
  }

  const storyMatch = url.pathname.match(/^\/viewer\/stories\/(\d+)\/?$/)
  if (storyMatch) return storyMatch[1]

  const episodeMatch = url.pathname.match(/^\/episodes\/(\d+)\/?$/)
  if (episodeMatch) return episodeMatch[1]

  return null
}
