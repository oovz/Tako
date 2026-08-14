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
