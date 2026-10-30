import { ProviderContractError } from "./provider-contract-error"

export class ImageAccessBatch<Access extends { remaining: number }> {
  private entries = new Map<string, Access>()
  private releaseAccess = () => {}

  constructor(private readonly expiredMessage: string) {}

  install(
    owned: Map<string, Access>,
    lifetime: number,
    signal?: AbortSignal
  ): void {
    this.release()
    this.entries = owned
    const cleanup = () => {
      owned.clear()
      clearTimeout(timer)
      signal?.removeEventListener("abort", cleanup)
    }
    const timer = setTimeout(cleanup, lifetime)
    signal?.addEventListener("abort", cleanup, { once: true })
    this.releaseAccess = cleanup
    if (signal?.aborted) cleanup()
  }

  release(): void {
    this.releaseAccess()
  }

  require(imageUrl: string): Access {
    const imageAccess = this.entries.get(imageUrl)
    if (!imageAccess) throw new ProviderContractError(this.expiredMessage)
    return imageAccess
  }

  consume(imageUrl: string, imageAccess?: Access): void {
    if (!imageAccess || this.entries.get(imageUrl) !== imageAccess) return
    if (--imageAccess.remaining === 0) {
      this.entries.delete(imageUrl)
      if (!this.entries.size) this.release()
    }
  }
}
