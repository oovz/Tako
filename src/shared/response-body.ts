/** Release a discarded response without delaying its owner's error or deadline. */
export function cancelResponseBody(response: Response, reason?: unknown): void {
  try {
    void response.body?.cancel(reason).catch(() => undefined)
  } catch {
    // Preserve the request outcome when cleanup fails.
  }
}
