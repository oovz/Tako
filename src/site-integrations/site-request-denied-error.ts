import { NonRetryableDownloadError } from "@/src/shared/download-contract"

export class SiteRequestDeniedError extends NonRetryableDownloadError {
  readonly category = "provider_access_denied" as const
  readonly status = 403

  constructor() {
    super("The site denied the request (HTTP 403).")
    this.name = "SiteRequestDeniedError"
  }
}
