import {
  NonRetryableDownloadError,
  type DownloadErrorCategory,
} from "@/src/shared/download-contract"

export class ProviderContractError extends NonRetryableDownloadError {
  readonly category =
    "provider_changed" as const satisfies DownloadErrorCategory

  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = "ProviderContractError"
  }
}
