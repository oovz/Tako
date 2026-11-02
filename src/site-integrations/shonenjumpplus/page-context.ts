/**
 * Parse the series aggregate ID from an episode page HTML string.
 * Does not require a DOM, so it can run in the service worker.
 */
export function parseAggregateIdFromHtml(html: string): string | null {
  if (typeof html !== "string") {
    return null
  }

  const match = html.match(
    /<[^>]*\bclass=["'][^"']*js-readable-products-pagination[^"']*["'][^>]*?\bdata-aggregate-id=["'](\d+)["'][^>]*>/i
  )
  return match?.[1] ?? null
}
