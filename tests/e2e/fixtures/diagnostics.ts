import type {
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
} from "@playwright/test"
import {
  redactDiagnostic,
  redactDiagnosticText,
} from "../../../src/runtime/diagnostic-redaction"

const OMITTED_PAYLOAD = "[External console payload omitted]"

async function consoleDiagnostic(message: ConsoleMessage): Promise<unknown> {
  const worker = message.worker()
  const page = message.page()
  const url = worker?.url() ?? page?.url()
  const diagnostic = {
    event: "console",
    source: worker ? "worker" : page ? "page" : "unknown",
    type: message.type(),
    url,
  }
  // Only extension-owned contexts emit our structured diagnostic contract.
  // Provider console previews may contain arbitrary page data or credentials.
  if (!url?.startsWith("chrome-extension://")) {
    return redactDiagnostic({ ...diagnostic, payload: OMITTED_PAYLOAD })
  }
  const args = await Promise.all(
    message
      .args()
      .slice(0, 20)
      .map(async (argument) => {
        try {
          return redactDiagnostic(await argument.jsonValue())
        } catch {
          return "[Console argument unavailable]"
        }
      })
  )
  return redactDiagnostic({ ...diagnostic, arguments: args })
}

function failedRequestDiagnostic(request: Request): unknown {
  const error = request.failure()?.errorText
  return redactDiagnostic({
    event: "request-failed",
    url: request.url(),
    errorCode:
      error && /^(?:net::)?ERR_[A-Z0-9_]+$/.test(error)
        ? error
        : "[Request failure detail omitted]",
  })
}

/** Install diagnostics for the lifetime of the fixture's browser context. */
export function installContextDiagnostics(context: BrowserContext): void {
  const log = (value: unknown) => console.log(redactDiagnosticText(value))
  context.on("console", (message) => {
    void consoleDiagnostic(message).then(log)
  })
  context.on("weberror", (webError) => {
    log(
      redactDiagnostic({
        event: "page-error",
        url: webError.page()?.url(),
        payload: "[Page error payload omitted]",
      })
    )
  })
  context.on("request", (request) => {
    if (request.url().startsWith("chrome-extension://")) return
    log(
      redactDiagnostic({
        event: "request",
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      })
    )
  })
  context.on("response", (response) => {
    if (response.ok() && response.url().startsWith("chrome-extension://"))
      return
    log(
      redactDiagnostic({
        event: "response",
        status: response.status(),
        url: response.url(),
      })
    )
  })
  context.on("requestfailed", (request) =>
    log(failedRequestDiagnostic(request))
  )
}

/** Capture warnings/errors and transport metadata for live workflow reports. */
export function installPageDiagnostics(
  page: Page,
  record: (value: unknown) => void
): void {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      void consoleDiagnostic(message).then(record)
    }
  })
  page.on("pageerror", () =>
    record(
      redactDiagnostic({
        event: "page-error",
        url: page.url(),
        payload: "[Page error payload omitted]",
      })
    )
  )
  page.on("requestfailed", (request) =>
    record(failedRequestDiagnostic(request))
  )
}
