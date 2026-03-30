import logger from '@/src/runtime/logger'

export function parseWorkId(pathname: string): string | null {
  const match = pathname.match(/^\/works\/(\d+)/)
  return match ? match[1] : null
}

function resolveWorkIdFromDocument(): string | null {
  const metadataCandidates = [
    document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
    document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  ]

  for (const candidate of metadataCandidates) {
    if (!candidate) continue
    try {
      const parsed = new URL(candidate, window.location.origin)
      const workId = parseWorkId(parsed.pathname)
      if (workId) {
        return workId
      }
    } catch {
      continue
    }
  }

  const workLink = document.querySelector<HTMLAnchorElement>('a[href*="/works/"]')?.getAttribute('href')
  if (!workLink) {
    return null
  }

  try {
    const parsed = new URL(workLink, window.location.origin)
    return parseWorkId(parsed.pathname)
  } catch {
    return null
  }
}

export function resolvePixivWorkIdFromPage(): string | null {
  return parseWorkId(window.location.pathname) ?? resolveWorkIdFromDocument()
}

export function parseEpisodeIdFromUrl(chapterUrl: string): string | null {
  const url = new URL(chapterUrl)
  const storyMatch = url.pathname.match(/\/viewer\/stories\/(\d+)/)
  if (storyMatch) return storyMatch[1]

  const episodeMatch = url.pathname.match(/\/episodes\/(\d+)/)
  if (episodeMatch) return episodeMatch[1]

  return null
}

function isPixivWorkPageReady(): boolean {
  return Boolean(resolvePixivWorkIdFromPage())
}

export async function waitForPixivWorkPageReady(timeoutMs = 8000): Promise<void> {
  if (isPixivWorkPageReady()) {
    return
  }

  const mutationObserverCtor = globalThis.MutationObserver
  if (typeof mutationObserverCtor !== 'function') {
    logger.debug('[pixiv-comic] MutationObserver unavailable while waiting for work page hydration')
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const observer = new mutationObserverCtor(() => {
      checkReady()
    })

    const observationTarget = document.documentElement ?? document.body ?? document.head
    if (!observationTarget) {
      logger.debug('[pixiv-comic] Work page did not fully hydrate before extraction timeout')
      resolve()
      return
    }

    const timeoutHandle = setTimeout(() => {
      finish(true)
    }, timeoutMs)

    const finish = (timedOut = false) => {
      if (settled) {
        return
      }

      settled = true
      observer.disconnect()
      clearTimeout(timeoutHandle)

      if (timedOut) {
        logger.debug('[pixiv-comic] Work page did not fully hydrate before extraction timeout')
      }

      resolve()
    }

    const checkReady = () => {
      if (isPixivWorkPageReady()) {
        finish()
      }
    }

    observer.observe(observationTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['content', 'href'],
    })

    checkReady()
  })
}
