import {
  runtimeMessageRegistry,
  type RuntimeMessage,
  type RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"

function invalidMessageError(
  kind: "request" | "response" | "retained request",
  type: string,
  error: { issues: readonly { path: PropertyKey[]; message: string }[] }
): Error {
  const issue = error.issues[0]
  const path = issue?.path.join(".")
  return new Error(
    `Invalid ${type} ${kind}${issue ? ` at ${path || "message"}: ${issue.message}` : ""}`
  )
}

export type RuntimeMessageSendOptions = {
  retentionKey?: string
}

export type RuntimeMessageRetryOptions = RuntimeMessageSendOptions & {
  attempts?: number
  delayMs?: number
}

const RETAINED_REQUEST_KEY_PREFIX = "runtime-command:"
const MAX_RETENTION_KEY_LENGTH = 160

function retentionStorageKey(retentionKey: string): string {
  if (
    retentionKey.length === 0 ||
    retentionKey.length > MAX_RETENTION_KEY_LENGTH
  ) {
    throw new Error(
      "Runtime message retention key is outside the supported bound"
    )
  }
  return `${RETAINED_REQUEST_KEY_PREFIX}${retentionKey}`
}

function sessionStorage(): chrome.storage.StorageArea {
  const area = chrome.storage?.session
  if (!area) {
    throw new Error(
      "Session storage is unavailable for retained runtime message"
    )
  }
  return area
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sameRequest(left: RuntimeMessage, right: RuntimeMessage): boolean {
  return (
    left.type === right.type && JSON.stringify(left) === JSON.stringify(right)
  )
}

function parseRuntimeRequest<TRequest extends RuntimeMessage>(
  request: TRequest
): TRequest {
  const entry = runtimeMessageRegistry[request.type]
  const parsedRequest = entry.request.safeParse(request)
  if (!parsedRequest.success) {
    throw invalidMessageError("request", request.type, parsedRequest.error)
  }
  return parsedRequest.data as TRequest
}

async function prepareRetainedRequest<TRequest extends RuntimeMessage>(
  request: TRequest,
  retentionKey: string
): Promise<{
  request: TRequest
  storageKey: string
}> {
  const entry = runtimeMessageRegistry[request.type]
  const storageKey = retentionStorageKey(retentionKey)
  const area = sessionStorage()
  const stored = await area.get(storageKey)
  if (!isRecord(stored)) {
    throw new Error(`Invalid retained ${request.type} request session data`)
  }
  if (Object.hasOwn(stored, storageKey)) {
    const parsedRetained = entry.request.safeParse(stored[storageKey])
    if (!parsedRetained.success) {
      throw invalidMessageError(
        "retained request",
        request.type,
        parsedRetained.error
      )
    }
    return {
      request: parsedRetained.data as TRequest,
      storageKey,
    }
  }

  await area.set({ [storageKey]: request })
  return { request, storageKey }
}

async function clearRetainedRequest<TRequest extends RuntimeMessage>(
  request: TRequest,
  storageKey: string | undefined
): Promise<void> {
  if (!storageKey) return
  const entry = runtimeMessageRegistry[request.type]
  const area = sessionStorage()
  const stored = await area.get(storageKey)
  if (!isRecord(stored)) {
    throw new Error(`Invalid retained ${request.type} request session data`)
  }
  if (!Object.hasOwn(stored, storageKey)) return
  const parsedRetained = entry.request.safeParse(stored[storageKey])
  if (!parsedRetained.success) {
    throw invalidMessageError(
      "retained request",
      request.type,
      parsedRetained.error
    )
  }
  if (!sameRequest(parsedRetained.data, request)) return
  await area.remove(storageKey)
}

export async function sendRuntimeMessage<TRequest extends RuntimeMessage>(
  request: TRequest,
  options: RuntimeMessageSendOptions = {}
): Promise<RuntimeMessageResponse<TRequest["type"]>> {
  const entry = runtimeMessageRegistry[request.type]
  const parsedRequest = parseRuntimeRequest(request)
  const prepared =
    options.retentionKey === undefined
      ? { request: parsedRequest, storageKey: undefined }
      : await prepareRetainedRequest(parsedRequest, options.retentionKey)

  const response: unknown = await chrome.runtime.sendMessage(prepared.request)
  const parsedResponse = entry.response.safeParse(response)
  if (!parsedResponse.success) {
    throw invalidMessageError("response", request.type, parsedResponse.error)
  }

  await clearRetainedRequest(prepared.request, prepared.storageKey)

  return parsedResponse.data as RuntimeMessageResponse<TRequest["type"]>
}

/**
 * Send a command retrying only transport-level failures with the SAME
 * envelope. Command identity is the idempotency key (commandId doubles as the
 * task ID for start/retry/restart, and mutating handlers converge on replay),
 * so re-delivering an identical envelope after an uncertain transport result
 * cannot create a duplicate semantic command. Logical failure responses are
 * returned, never retried.
 */
export async function sendRuntimeMessageWithRetry<
  TRequest extends RuntimeMessage,
>(
  request: TRequest,
  options: RuntimeMessageRetryOptions = {}
): Promise<RuntimeMessageResponse<TRequest["type"]>> {
  const entry = runtimeMessageRegistry[request.type]
  const parsedRequest = parseRuntimeRequest(request)
  const prepared =
    options.retentionKey === undefined
      ? { request: parsedRequest, storageKey: undefined }
      : await prepareRetainedRequest(parsedRequest, options.retentionKey)

  const attempts = Math.max(1, options.attempts ?? 2)
  let response: unknown
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await chrome.runtime.sendMessage(prepared.request)
      break
    } catch (error) {
      if (attempt + 1 >= attempts) throw error
      if (options.delayMs !== undefined && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      }
    }
  }

  const parsedResponse = entry.response.safeParse(response)
  if (!parsedResponse.success) {
    throw invalidMessageError("response", request.type, parsedResponse.error)
  }
  await clearRetainedRequest(prepared.request, prepared.storageKey)
  return parsedResponse.data as RuntimeMessageResponse<TRequest["type"]>
}
