import {
  RuntimeFailureSchema,
  runtimeMessageRegistry,
  type RuntimeMessagePrincipal,
  type RuntimeMessageReadiness,
  type RuntimeMessageRequest,
  type RuntimeMessageResponse,
  type RuntimeMessageTarget,
  type RuntimeMessageType,
  type RuntimeMessageTypesForTarget,
} from "@/src/runtime/runtime-message-contracts"

export type RuntimeMessageHandlerMap<TTarget extends RuntimeMessageTarget> = {
  [TType in RuntimeMessageTypesForTarget<TTarget>]: (
    request: RuntimeMessageRequest<TType>,
    sender: chrome.runtime.MessageSender
  ) => Promise<RuntimeMessageResponse<TType>> | RuntimeMessageResponse<TType>
}

export interface RuntimeMessageDispatcherOptions<
  TTarget extends RuntimeMessageTarget,
> {
  target: TTarget
  handlers: RuntimeMessageHandlerMap<TTarget>
  classifySender: (
    sender: chrome.runtime.MessageSender
  ) => RuntimeMessagePrincipal
  waitForReadiness: (readiness: RuntimeMessageReadiness) => Promise<void>
  reportError?: (message: string, error: unknown) => void
}

export type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function claimsRuntimeMessageTarget(
  message: unknown,
  target: RuntimeMessageTarget
): boolean {
  return isRecord(message) && message.target === target
}

export function mapRuntimeMessageFailure(
  error: unknown,
  fallback: string
): { success: false; error: string } {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const message = rawMessage.trim().length > 0 ? rawMessage : fallback
  return RuntimeFailureSchema.parse({ success: false, error: message })
}

function readMessageType(message: unknown): RuntimeMessageType | null {
  if (!isRecord(message) || typeof message.type !== "string") return null
  return Object.hasOwn(runtimeMessageRegistry, message.type)
    ? (message.type as RuntimeMessageType)
    : null
}

function validateResponse<TType extends RuntimeMessageType>(
  type: TType,
  response: unknown
): RuntimeMessageResponse<TType> {
  const parsed = runtimeMessageRegistry[type].response.safeParse(response)
  if (!parsed.success) {
    throw new Error(`Handler returned an invalid ${type} response`)
  }
  return parsed.data as RuntimeMessageResponse<TType>
}

export async function dispatchRuntimeMessage<
  TTarget extends RuntimeMessageTarget,
>(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  options: RuntimeMessageDispatcherOptions<TTarget>
): Promise<unknown> {
  if (!claimsRuntimeMessageTarget(message, options.target)) {
    return mapRuntimeMessageFailure(
      "Runtime message target was not claimed",
      "Runtime message target was not claimed"
    )
  }

  const type = readMessageType(message)
  if (!type || runtimeMessageRegistry[type].target !== options.target) {
    return mapRuntimeMessageFailure(
      "Unknown runtime message type",
      "Unknown runtime message type"
    )
  }

  const entry = runtimeMessageRegistry[type]
  const parsedRequest = entry.request.safeParse(message)
  if (!parsedRequest.success) {
    return mapRuntimeMessageFailure(
      `Invalid ${type} request`,
      `Invalid ${type} request`
    )
  }

  const principal = options.classifySender(sender)
  if (
    !(entry.allowedSenders as readonly RuntimeMessagePrincipal[]).includes(
      principal
    )
  ) {
    return mapRuntimeMessageFailure(
      `${type} is not authorized for ${principal}`,
      `Unauthorized ${type} sender`
    )
  }

  const executeHandler = async (): Promise<unknown> => {
    try {
      await options.waitForReadiness(entry.readiness)
      const handler = options.handlers[
        type as RuntimeMessageTypesForTarget<TTarget>
      ] as unknown as (
        request: typeof parsedRequest.data,
        sender: chrome.runtime.MessageSender
      ) => unknown
      const response = await handler(parsedRequest.data, sender)
      return validateResponse(type, response)
    } catch (error) {
      options.reportError?.(`Runtime message ${type} failed`, error)
      return mapRuntimeMessageFailure(error, `${type} failed`)
    }
  }

  return await executeHandler()
}

export function createRuntimeMessageListener<
  TTarget extends RuntimeMessageTarget,
>(options: RuntimeMessageDispatcherOptions<TTarget>): RuntimeMessageListener {
  return (message, sender, sendResponse) => {
    if (!claimsRuntimeMessageTarget(message, options.target)) return false

    void dispatchRuntimeMessage(message, sender, options).then(sendResponse)
    return true
  }
}
