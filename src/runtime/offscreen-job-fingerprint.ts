import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

export type FingerprintedOffscreenDispatchPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]

type DispatchFingerprintInput = Omit<
  FingerprintedOffscreenDispatchPayload,
  "fingerprint"
>

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Dispatch fingerprints require finite numbers")
    }
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === "object") {
    const prototype = Reflect.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Dispatch fingerprints require plain data objects")
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  throw new TypeError("Dispatch fingerprints require JSON-compatible data")
}

export function serializeOffscreenDispatchPayload(
  payload: DispatchFingerprintInput
): string {
  return JSON.stringify(canonicalize(payload))
}

export async function createOffscreenDispatchFingerprint(
  payload: DispatchFingerprintInput
): Promise<string> {
  const bytes = new TextEncoder().encode(
    serializeOffscreenDispatchPayload(payload)
  )
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function offscreenDispatchFingerprintMatches(
  payload: FingerprintedOffscreenDispatchPayload
): Promise<boolean> {
  const { fingerprint, ...fingerprinted } = payload
  return (
    (await createOffscreenDispatchFingerprint(fingerprinted)) === fingerprint
  )
}
