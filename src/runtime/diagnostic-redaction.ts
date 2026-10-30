export const REDACTED_DIAGNOSTIC_VALUE = "[REDACTED]"
export const REDACTED_DIAGNOSTIC_PATH = "[REDACTED_PATH]"

const CIRCULAR_DIAGNOSTIC_VALUE = "[Circular]"
const UNREADABLE_DIAGNOSTIC_VALUE = "[Unreadable]"
const MAX_DIAGNOSTIC_DEPTH = 8
const MAX_DIAGNOSTIC_OBJECT_KEYS = 100
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 100
const MAX_DIAGNOSTIC_STRING_LENGTH = 2_000

const URL_PATTERN =
  /\b(?:https?|wss?|ftp|file|chrome-extension):\/\/[^\s<>"'`]+/gi
const WINDOWS_PATH_PATTERN =
  /(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]|\\\\)(?:[^<>:"|?*\r\n]+[\\/])*[^<>:"|?*\r\n]*/g
const POSIX_PATH_PATTERN =
  /(?:^|[\s"'(=])\/(?:Users|home|private|var\/folders|tmp|workspace|workspaces|runner|mnt|opt)(?:\/[^\s<>"'`]*)*/gi

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|api[-_]?key|(?:access|refresh|id)?[-_]?token|password|passphrase|secret|credential|private[-_]?key|client[-_]?secret|bearer|session[-_]?id)/i

const SAFE_HEADER_KEYS = new Set(["content-type", "content-length"])

const PATH_KEYS = new Set([
  "path",
  "filepath",
  "filename",
  "directory",
  "directorypath",
  "userdatadir",
  "profiledir",
  "profilepath",
  "outputpath",
  "localpath",
  "tempdir",
  "temppath",
])

type RedactionState = {
  depth: number
  seen: WeakSet<object>
}

function normalizeKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase()
}

function isPathKey(key: string): boolean {
  return PATH_KEYS.has(normalizeKey(key))
}

function isSensitiveKey(key: string): boolean {
  return (
    SENSITIVE_KEY_PATTERN.test(key) ||
    /(?:body|html|responseText|requestText)$/i.test(key)
  )
}

function isHeadersKey(key: string): boolean {
  return /headers?$/i.test(key)
}

function isSensitiveHeader(key: string): boolean {
  return !isSafeHeader(key) || SENSITIVE_KEY_PATTERN.test(key)
}

function isSafeHeader(key: string): boolean {
  return SAFE_HEADER_KEYS.has(key.toLowerCase())
}

type DataPropertyRead =
  | { kind: "value"; value: unknown }
  | { kind: "missing" }
  | { kind: "unreadable" }

type HeaderEntryInspection =
  | { kind: "entry"; name: string; value: string }
  | { kind: "not-entry" }
  | { kind: "unreadable" }

type HeaderEntriesInspection =
  | { kind: "entries"; entries: Array<[string, string]> }
  | { kind: "not-entries" }
  | { kind: "unreadable" }

function readDataProperty(value: object, key: string): DataPropertyRead {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { kind: "missing" }
    if (!("value" in descriptor)) return { kind: "unreadable" }
    return { kind: "value", value: descriptor.value }
  } catch {
    return { kind: "unreadable" }
  }
}

function readProperty(value: object, key: string): unknown {
  const read = readDataProperty(value, key)
  return read.kind === "value" ? read.value : UNREADABLE_DIAGNOSTIC_VALUE
}

function readArrayLength(value: unknown[]): number | null {
  const read = readDataProperty(value, "length")
  if (read.kind !== "value" || typeof read.value !== "number") return null
  return Number.isSafeInteger(read.value) && read.value >= 0 ? read.value : null
}

function readArrayCell(value: unknown[], index: number): DataPropertyRead {
  return readDataProperty(value, String(index))
}

function inspectArray(value: unknown): boolean | undefined {
  try {
    return Array.isArray(value)
  } catch {
    return undefined
  }
}

function inspectHeaderCells(
  name: DataPropertyRead,
  headerValue: DataPropertyRead
): HeaderEntryInspection {
  if (name.kind === "unreadable" || headerValue.kind === "unreadable") {
    return { kind: "unreadable" }
  }
  if (name.kind !== "value" || headerValue.kind !== "value") {
    return { kind: "not-entry" }
  }
  if (typeof name.value !== "string" || typeof headerValue.value !== "string") {
    return { kind: "not-entry" }
  }
  return { kind: "entry", name: name.value, value: headerValue.value }
}

function inspectHeaderEntry(value: unknown): HeaderEntryInspection {
  const isArray = inspectArray(value)
  if (isArray === undefined) return { kind: "unreadable" }
  if (!isArray) return { kind: "not-entry" }

  const length = readArrayLength(value as unknown[])
  if (length === null) return { kind: "unreadable" }
  if (length !== 2) return { kind: "not-entry" }

  return inspectHeaderCells(
    readArrayCell(value as unknown[], 0),
    readArrayCell(value as unknown[], 1)
  )
}

function inspectHeaderListCell(cell: DataPropertyRead): HeaderEntryInspection {
  if (cell.kind === "unreadable") return { kind: "unreadable" }
  if (cell.kind !== "value") return { kind: "not-entry" }
  return inspectHeaderEntry(cell.value)
}

function inspectHeaderEntries(array: unknown[]): HeaderEntriesInspection {
  const length = readArrayLength(array)
  if (length === null) return { kind: "unreadable" }
  if (length === 0) return { kind: "not-entries" }

  const entries: Array<[string, string]> = []
  const limit = Math.min(length, MAX_DIAGNOSTIC_ARRAY_ITEMS)
  for (let index = 0; index < limit; index += 1) {
    const entry = inspectHeaderListCell(readArrayCell(array, index))
    if (entry.kind === "unreadable") return { kind: "unreadable" }
    if (entry.kind !== "entry") return { kind: "not-entries" }
    entries.push([entry.name, entry.value])
  }
  return { kind: "entries", entries }
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol === "file:") return REDACTED_DIAGNOSTIC_PATH
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return REDACTED_DIAGNOSTIC_VALUE
  }
}

function isSerializedDiagnostic(value: string): boolean {
  return (
    value.startsWith("{") ||
    value.startsWith('"') ||
    /^\[\s*(?:[[{"\d-]|true\b|false\b|null\b|\])/.test(value)
  )
}

function redactPathMatch(match: string): string {
  const prefix = match.match(/^[\s"'(=]/)?.[0] ?? ""
  return `${prefix}${REDACTED_DIAGNOSTIC_PATH}`
}

function containsOpaqueDiagnostic(value: string): boolean {
  return (
    value.includes("{") ||
    /\\u[0-9a-f]{4}|\[\s*(?:[[{"\d-]|true\b|false\b|null\b|\])/i.test(value) ||
    /\b(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|api[-_]?key|(?:access|refresh|id)?[-_]?token|password|passphrase|secret|credential|private[-_]?key|client[-_]?secret|session[-_]?id|x[-_][\w-]+|[\w-]*session[\w-]*)["']?\s*[:=]|\b(?:bearer|basic)\s+\S+/i.test(
      value
    )
  )
}

function redactString(value: string, state: RedactionState): string {
  if (
    value.length > MAX_DIAGNOSTIC_STRING_LENGTH ||
    state.depth >= MAX_DIAGNOSTIC_DEPTH
  ) {
    return REDACTED_DIAGNOSTIC_VALUE
  }
  const trimmed = value.trim()
  if (isSerializedDiagnostic(trimmed)) {
    try {
      return JSON.stringify(
        redactValue(JSON.parse(trimmed), "", {
          depth: state.depth + 1,
          seen: state.seen,
        })
      )
    } catch {
      return REDACTED_DIAGNOSTIC_VALUE
    }
  }
  // Embedded or malformed object dumps are opaque. Do not attempt to recover
  // fields from a partial serialization (including an Error stack's prefix).
  let redacted = value.replace(URL_PATTERN, redactUrl)
  if (containsOpaqueDiagnostic(redacted)) return REDACTED_DIAGNOSTIC_VALUE
  redacted = redacted.replace(WINDOWS_PATH_PATTERN, redactPathMatch)
  redacted = redacted.replace(POSIX_PATH_PATTERN, redactPathMatch)
  if (redacted.length <= MAX_DIAGNOSTIC_STRING_LENGTH) return redacted
  return `${redacted.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}…`
}

function redactHeaderValue(
  name: string,
  value: unknown,
  state: RedactionState
): unknown {
  return isSafeHeader(name) && !isSensitiveHeader(name)
    ? redactValue(value, name, state)
    : REDACTED_DIAGNOSTIC_VALUE
}

function redactNativeHeaders(value: Headers, state: RedactionState): unknown {
  const result: Record<string, unknown> = {}
  try {
    for (const [name, headerValue] of value.entries()) {
      result[name] = redactHeaderValue(name, headerValue, state)
    }
  } catch {
    return UNREADABLE_DIAGNOSTIC_VALUE
  }
  return result
}

function redactHeaderList(value: unknown[], state: RedactionState): unknown {
  const inspected = inspectHeaderEntries(value)
  if (inspected.kind === "unreadable") return UNREADABLE_DIAGNOSTIC_VALUE
  if (inspected.kind !== "entries") return REDACTED_DIAGNOSTIC_VALUE
  return redactHeaderEntries(inspected.entries, state)
}

function redactHeaders(value: unknown, state: RedactionState): unknown {
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return redactNativeHeaders(value, state)
  }

  if (Array.isArray(value)) return redactHeaderList(value, state)

  if (typeof value === "string") return REDACTED_DIAGNOSTIC_VALUE
  if (!value || typeof value !== "object") return REDACTED_DIAGNOSTIC_VALUE
  if (value instanceof Map || value instanceof Set) {
    return REDACTED_DIAGNOSTIC_VALUE
  }

  return redactObject(value as Record<string, unknown>, state, true)
}

function redactHeaderEntries(
  entries: Array<[string, string]>,
  state: RedactionState
): Array<[string, unknown]> {
  return entries.map(([name, headerValue]) => [
    name,
    redactHeaderValue(name, headerValue, state),
  ])
}

function redactError(
  value: Error,
  state: RedactionState
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: redactString(value.name, state),
    message: redactString(value.message, state),
  }
  if (value.stack) result.stack = redactString(value.stack, state)

  const childState: RedactionState = {
    depth: state.depth + 1,
    seen: state.seen,
  }

  if (Object.hasOwn(value, "cause")) {
    result.cause = redactValue(
      (value as Error & { cause?: unknown }).cause,
      "cause",
      childState
    )
  }

  for (const key of Object.keys(value).slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS)) {
    if (key === "cause" || Object.hasOwn(result, key)) continue
    result[key] = redactValue(readProperty(value, key), key, childState)
  }
  return result
}

function redactObjectProperty(
  value: Record<string, unknown>,
  key: string,
  state: RedactionState,
  headers: boolean
): unknown {
  if (isSensitiveKey(key) || isPathKey(key)) return REDACTED_DIAGNOSTIC_VALUE
  if (headers) return redactHeaderValue(key, readProperty(value, key), state)
  if (isHeadersKey(key)) return redactHeaders(readProperty(value, key), state)
  return redactValue(readProperty(value, key), key, state)
}

function redactObject(
  value: Record<string, unknown>,
  state: RedactionState,
  headers = false
): unknown {
  if (state.depth >= MAX_DIAGNOSTIC_DEPTH) {
    return REDACTED_DIAGNOSTIC_VALUE
  }
  if (state.seen.has(value)) return CIRCULAR_DIAGNOSTIC_VALUE
  state.seen.add(value)

  const childState: RedactionState = {
    depth: state.depth + 1,
    seen: state.seen,
  }
  const result: Record<string, unknown> = {}
  let keys: string[]
  try {
    keys = Object.keys(value).slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS)
  } catch {
    return UNREADABLE_DIAGNOSTIC_VALUE
  }
  for (const key of keys) {
    result[key] = redactObjectProperty(value, key, childState, headers)
  }
  return result
}

function redactPrimitive(value: unknown, state: RedactionState): unknown {
  switch (typeof value) {
    case "string":
      return redactString(value, state)
    case "bigint":
      return "[BigInt]"
    case "function":
      return "[Function]"
    case "symbol":
      return "[Symbol]"
    default:
      return value
  }
}

function redactTrackedError(value: Error, state: RedactionState): unknown {
  if (state.depth >= MAX_DIAGNOSTIC_DEPTH) return REDACTED_DIAGNOSTIC_VALUE
  if (state.seen.has(value)) return CIRCULAR_DIAGNOSTIC_VALUE
  state.seen.add(value)
  return redactError(value, state)
}

function redactArrayItem(
  value: unknown[],
  index: number,
  state: RedactionState
): unknown {
  const item = readArrayCell(value, index)
  if (item.kind !== "value") return UNREADABLE_DIAGNOSTIC_VALUE
  try {
    return redactValue(item.value, "", state)
  } catch {
    return UNREADABLE_DIAGNOSTIC_VALUE
  }
}

function redactArrayItems(value: unknown[], state: RedactionState): unknown {
  if (state.seen.has(value)) return CIRCULAR_DIAGNOSTIC_VALUE
  state.seen.add(value)
  const childState: RedactionState = {
    depth: state.depth + 1,
    seen: state.seen,
  }
  const length = readArrayLength(value)
  if (length === null) return UNREADABLE_DIAGNOSTIC_VALUE
  const items: unknown[] = []
  const limit = Math.min(length, MAX_DIAGNOSTIC_ARRAY_ITEMS)
  for (let index = 0; index < limit; index += 1) {
    items.push(redactArrayItem(value, index, childState))
  }
  return items
}

function redactArray(value: unknown[], state: RedactionState): unknown {
  if (state.depth >= MAX_DIAGNOSTIC_DEPTH) return REDACTED_DIAGNOSTIC_VALUE
  const headerEntries = inspectHeaderEntries(value)
  if (headerEntries.kind === "entries")
    return redactHeaderEntries(headerEntries.entries, state)
  const headerEntry = inspectHeaderEntry(value)
  if (headerEntry.kind === "unreadable") return UNREADABLE_DIAGNOSTIC_VALUE
  if (headerEntry.kind === "entry" && isSensitiveHeader(headerEntry.name)) {
    return [headerEntry.name, REDACTED_DIAGNOSTIC_VALUE]
  }
  return redactArrayItems(value, state)
}

function redactOpaqueOrRecord(value: object, state: RedactionState): unknown {
  if (typeof Headers !== "undefined" && value instanceof Headers)
    return redactHeaders(value, state)
  if (value instanceof Map || value instanceof Set)
    return REDACTED_DIAGNOSTIC_VALUE
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
    return "[Binary diagnostic omitted]"
  return redactObject(value as Record<string, unknown>, state)
}

function redactObjectValue(value: object, state: RedactionState): unknown {
  if (value instanceof URL) return redactUrl(value.toString())
  if (
    typeof URLSearchParams !== "undefined" &&
    value instanceof URLSearchParams
  )
    return REDACTED_DIAGNOSTIC_VALUE
  if (value instanceof Error) return redactTrackedError(value, state)
  if (Array.isArray(value)) return redactArray(value, state)
  return redactOpaqueOrRecord(value, state)
}

function redactValue(
  value: unknown,
  key: string,
  state: RedactionState
): unknown {
  if (isSensitiveKey(key) || isPathKey(key)) return REDACTED_DIAGNOSTIC_VALUE
  if (isHeadersKey(key)) return redactHeaders(value, state)
  return typeof value === "object" && value !== null
    ? redactObjectValue(value, state)
    : redactPrimitive(value, state)
}

/** Convert an arbitrary diagnostic value into a bounded, redacted value. */
export function redactDiagnostic(value: unknown): unknown {
  return redactValue(value, "", { depth: 0, seen: new WeakSet<object>() })
}

/** Format a diagnostic value after applying the same redaction boundary. */
export function redactDiagnosticText(value: unknown): string {
  const redacted = redactDiagnostic(value)
  if (typeof redacted === "string") return redacted
  try {
    const serialized = JSON.stringify(redacted)
    return serialized ?? String(redacted)
  } catch {
    return UNREADABLE_DIAGNOSTIC_VALUE
  }
}
