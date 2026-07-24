import type { DownloadErrorCategory } from "@/src/shared/download-contract"

export class ProviderContractError extends Error {
  readonly category =
    "provider_changed" as const satisfies DownloadErrorCategory

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "ProviderContractError"
  }
}
