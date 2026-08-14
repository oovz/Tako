import {
  runtimeMessageRegistry,
  type RuntimeMessage,
  type RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"

export async function sendRuntimeMessage<TRequest extends RuntimeMessage>(
  request: TRequest
): Promise<RuntimeMessageResponse<TRequest["type"]>> {
  const entry = runtimeMessageRegistry[request.type]
  const parsedRequest = entry.request.safeParse(request)
  if (!parsedRequest.success) {
    const issue = parsedRequest.error.issues[0]
    const path = issue?.path.join(".")
    throw new Error(
      `Invalid ${request.type} request${issue ? ` at ${path || "message"}: ${issue.message}` : ""}`
    )
  }

  const response: unknown = await chrome.runtime.sendMessage(parsedRequest.data)
  const parsedResponse = entry.response.safeParse(response)
  if (!parsedResponse.success) {
    const issue = parsedResponse.error.issues[0]
    const path = issue?.path.join(".")
    throw new Error(
      `Invalid ${request.type} response${issue ? ` at ${path || "message"}: ${issue.message}` : ""}`
    )
  }

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
  options: { attempts?: number; delayMs?: number } = {}
): Promise<RuntimeMessageResponse<TRequest["type"]>> {
  const attempts = Math.max(1, options.attempts ?? 2)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendRuntimeMessage(request)
    } catch (error) {
      if (attempt + 1 >= attempts) throw error
      if (options.delayMs !== undefined && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      }
    }
  }
}
