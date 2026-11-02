/** A provider wait owns its timer and abort listener until either settles. */
export async function waitForMangadexDelay(
  delayMs: number,
  signal?: AbortSignal | null
): Promise<void> {
  if (delayMs <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("aborted"))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
