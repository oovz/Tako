import {
  isNativeOutputAcceptanceProvenAbsent,
  isNativeOutputTerminal,
  nativeOutputIdentityMatches,
  nativeOutputJobIdentityMatches,
  type NativeOutputAccountingDisposition,
  type NativeOutputIdentity,
  type NativeOutputJobIdentity,
  type NativeOutputManifest,
  type NativeOutputRecord,
  type NativeOutputState,
} from "./state"

export type NativeOutputApplied<T extends object = Record<never, never>> = {
  outcome: "applied"
} & T

export type NativeOutputUnchanged<T extends object = Record<never, never>> = {
  outcome: "unchanged"
} & T

export type NativeOutputRejected<
  TReason extends string,
  T extends object = Record<never, never>,
> = { outcome: "rejected"; reason: TReason } & T

export interface NativeOutputKernelDecision<TResult> {
  next: NativeOutputState
  result: TResult
}

type ManifestConflict = NativeOutputRejected<"manifest-conflict">
type OutputNotFound = NativeOutputRejected<"output-not-found">
type InvalidTransition = NativeOutputRejected<"invalid-transition">

function applied<TResult extends object>(
  state: NativeOutputState,
  result: TResult
): NativeOutputKernelDecision<NativeOutputApplied<TResult>> {
  return { next: state, result: { outcome: "applied", ...result } }
}

function unchanged<TResult extends object>(
  state: NativeOutputState,
  result: TResult
): NativeOutputKernelDecision<NativeOutputUnchanged<TResult>> {
  return { next: state, result: { outcome: "unchanged", ...result } }
}

function rejected<TReason extends string>(
  state: NativeOutputState,
  reason: TReason
): NativeOutputKernelDecision<NativeOutputRejected<TReason>> {
  return { next: state, result: { outcome: "rejected", reason } }
}

function replaceManifest(
  state: NativeOutputState,
  manifest: NativeOutputManifest
): NativeOutputState {
  return {
    ...state,
    manifestsByJobId: {
      ...state.manifestsByJobId,
      [manifest.jobId]: manifest,
    },
  }
}

function replaceOutput(
  state: NativeOutputState,
  record: NativeOutputRecord
): NativeOutputState {
  return {
    ...state,
    outputsByOutputId: {
      ...state.outputsByOutputId,
      [record.outputId]: record,
    },
  }
}

function manifestMatches(
  manifest: NativeOutputManifest,
  input: NativeOutputJobIdentity & { outputsRequested: number }
): boolean {
  return (
    nativeOutputJobIdentityMatches(manifest, input) &&
    manifest.outputsRequested === input.outputsRequested
  )
}

export function ensureNativeOutputManifest(
  state: NativeOutputState,
  input: NativeOutputJobIdentity & { outputsRequested: number; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ manifest: NativeOutputManifest }>
  | NativeOutputUnchanged<{ manifest: NativeOutputManifest }>
  | ManifestConflict
> {
  const current = state.manifestsByJobId[input.jobId]
  if (current) {
    if (!manifestMatches(current, input)) {
      return rejected(state, "manifest-conflict")
    }
    return unchanged(state, { manifest: current })
  }

  const manifest: NativeOutputManifest = {
    jobId: input.jobId,
    attempt: input.attempt,
    taskId: input.taskId,
    chapterId: input.chapterId,
    fingerprint: input.fingerprint,
    documentInstanceId: input.documentInstanceId,
    phase: "open",
    outputsRequested: input.outputsRequested,
    outputsFailedBeforeHandoff: 0,
    slots: Array.from({ length: input.outputsRequested }, () => null),
    createdAt: input.now,
  }
  return applied(replaceManifest(state, manifest), { manifest })
}

export function prepareNativeOutput(
  state: NativeOutputState,
  input: NativeOutputIdentity & { now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{
      manifest: NativeOutputManifest
      record: NativeOutputRecord
    }>
  | NativeOutputUnchanged<{
      manifest: NativeOutputManifest
      record: NativeOutputRecord
    }>
  | NativeOutputRejected<
      | "manifest-conflict"
      | "manifest-sealed"
      | "output-identity-conflict"
      | "output-index-conflict"
      | "blob-url-conflict"
      | "output-index-out-of-range"
    >
> {
  const existing = state.outputsByOutputId[input.outputId]
  if (existing) {
    if (!nativeOutputIdentityMatches(existing, input)) {
      return rejected(state, "output-identity-conflict")
    }
    const manifest = state.manifestsByJobId[input.jobId]
    if (
      !manifest ||
      !manifestMatches(manifest, {
        ...input,
        outputsRequested: input.outputCount,
      })
    ) {
      return rejected(state, "manifest-conflict")
    }
    return unchanged(state, { manifest, record: existing })
  }

  if (input.outputIndex < 0 || input.outputIndex >= input.outputCount) {
    return rejected(state, "output-index-out-of-range")
  }
  if (
    Object.values(state.outputsByOutputId).some(
      (record) => record.blobUrl === input.blobUrl
    )
  ) {
    return rejected(state, "blob-url-conflict")
  }

  const manifestDecision = ensureNativeOutputManifest(state, {
    jobId: input.jobId,
    attempt: input.attempt,
    taskId: input.taskId,
    chapterId: input.chapterId,
    fingerprint: input.fingerprint,
    documentInstanceId: input.documentInstanceId,
    outputsRequested: input.outputCount,
    now: input.now,
  })
  if (manifestDecision.result.outcome === "rejected") {
    return rejected(state, "manifest-conflict")
  }
  const manifest = manifestDecision.result.manifest
  if (manifest.phase === "sealed") {
    return rejected(state, "manifest-sealed")
  }
  if (manifest.slots[input.outputIndex] !== null) {
    return rejected(state, "output-index-conflict")
  }

  const record: NativeOutputRecord = {
    outputId: input.outputId,
    jobId: input.jobId,
    attempt: input.attempt,
    taskId: input.taskId,
    chapterId: input.chapterId,
    fingerprint: input.fingerprint,
    documentInstanceId: input.documentInstanceId,
    outputIndex: input.outputIndex,
    outputCount: input.outputCount,
    blobUrl: input.blobUrl,
    filename: input.filename,
    outputKind: input.outputKind,
    phase: "prepared",
    createdAt: input.now,
    accountingDisposition: "pending",
  }
  const slots = [...manifest.slots]
  slots[input.outputIndex] = {
    disposition: "tracked",
    outputId: input.outputId,
  }
  const updatedManifest = { ...manifest, slots }
  const next = replaceOutput(
    replaceManifest(manifestDecision.next, updatedManifest),
    record
  )
  return applied(next, { manifest: updatedManifest, record })
}

export function sealNativeOutputManifest(
  state: NativeOutputState,
  input: NativeOutputJobIdentity & {
    outputsRequested: number
    outputsFailedBeforeHandoff: number
    now: number
    error: string
  }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ manifest: NativeOutputManifest }>
  | NativeOutputUnchanged<{ manifest: NativeOutputManifest }>
  | NativeOutputRejected<"manifest-conflict" | "untracked-count-conflict">
> {
  const ensured = ensureNativeOutputManifest(state, {
    ...input,
    now: input.now,
  })
  if (ensured.result.outcome === "rejected") {
    return rejected(state, "manifest-conflict")
  }
  const manifest = ensured.result.manifest
  if (manifest.phase === "sealed") {
    if (
      manifest.outputsFailedBeforeHandoff !== input.outputsFailedBeforeHandoff
    ) {
      return rejected(state, "manifest-conflict")
    }
    return unchanged(state, { manifest })
  }

  const emptySlotCount = manifest.slots.filter((slot) => slot === null).length
  if (emptySlotCount !== input.outputsFailedBeforeHandoff) {
    return rejected(state, "untracked-count-conflict")
  }
  const slots = manifest.slots.map(
    (slot) =>
      slot ?? {
        disposition: "untracked_failed" as const,
        failedAt: input.now,
        error: input.error,
      }
  )
  const sealed: NativeOutputManifest = {
    ...manifest,
    phase: "sealed",
    outputsFailedBeforeHandoff: input.outputsFailedBeforeHandoff,
    slots,
    sealedAt: input.now,
  }
  return applied(replaceManifest(ensured.next, sealed), { manifest: sealed })
}

export function markNativeOutputAcceptanceUnknown(
  state: NativeOutputState,
  input: { outputId: string; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (current.phase === "acceptance_unknown") {
    return unchanged(state, { record: current })
  }
  if (current.phase !== "prepared") {
    return rejected(state, "invalid-transition")
  }
  const record: NativeOutputRecord = {
    ...current,
    phase: "acceptance_unknown",
    acceptanceStartedAt: input.now,
  }
  return applied(replaceOutput(state, record), { record })
}

export function attachNativeDownload(
  state: NativeOutputState,
  input: { outputId: string; downloadId: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
  | NativeOutputRejected<"download-id-conflict">
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (current.downloadId !== undefined) {
    return current.downloadId === input.downloadId
      ? unchanged(state, { record: current })
      : rejected(state, "download-id-conflict")
  }
  if (current.phase !== "acceptance_unknown") {
    return rejected(state, "invalid-transition")
  }
  if (
    Object.values(state.outputsByOutputId).some(
      (record) => record.downloadId === input.downloadId
    )
  ) {
    return rejected(state, "download-id-conflict")
  }
  const record: NativeOutputRecord = {
    ...current,
    phase: "waiting",
    downloadId: input.downloadId,
  }
  return applied(replaceOutput(state, record), { record })
}

export function interruptNativeOutputBeforeAcceptance(
  state: NativeOutputState,
  input: { outputId: string; error: string; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (current.phase === "interrupted" && current.downloadId === undefined) {
    return unchanged(state, { record: current })
  }
  if (current.phase !== "prepared" && current.phase !== "acceptance_unknown") {
    return rejected(state, "invalid-transition")
  }
  const record: NativeOutputRecord = {
    ...current,
    phase: "interrupted",
    terminalAt: input.now,
    error: input.error,
  }
  return applied(replaceOutput(state, record), { record })
}

export function markNativeDownloadTerminal(
  state: NativeOutputState,
  input: {
    downloadId: number
    phase: "complete" | "interrupted"
    now: number
    error?: string
  }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | NativeOutputRejected<"download-not-found" | "terminal-conflict">
  | InvalidTransition
> {
  const current = Object.values(state.outputsByOutputId).find(
    (record) => record.downloadId === input.downloadId
  )
  if (!current) return rejected(state, "download-not-found")
  if (isNativeOutputTerminal(current)) {
    return current.phase === input.phase
      ? unchanged(state, { record: current })
      : rejected(state, "terminal-conflict")
  }
  if (current.phase !== "waiting") {
    return rejected(state, "invalid-transition")
  }
  const record: NativeOutputRecord = {
    ...current,
    phase: input.phase,
    terminalAt: input.now,
    error: input.error,
  }
  return applied(replaceOutput(state, record), { record })
}

export function observeNativeDownloadErased(
  state: NativeOutputState,
  input: { downloadId: number; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | NativeOutputRejected<"download-not-found">
> {
  const current = Object.values(state.outputsByOutputId).find(
    (record) => record.downloadId === input.downloadId
  )
  if (!current) return rejected(state, "download-not-found")
  if (current.erasedAt !== undefined) {
    return unchanged(state, { record: current })
  }
  const record = { ...current, erasedAt: input.now }
  return applied(replaceOutput(state, record), { record })
}

/**
 * Explicit user surrender of an unobservable Chrome download (FORGET).
 * Only waiting records whose download was erased from Chrome history qualify:
 * their result can never be observed again, and the user has accepted that
 * fact. Surrender does not claim complete or interrupted — the outcome stays
 * unknown — but it does release the queue block and later the Blob ownership.
 */
export function markNativeOutputSurrendered(
  state: NativeOutputState,
  input: { outputId: string; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (current.phase === "surrendered") {
    return unchanged(state, { record: current })
  }
  if (current.phase !== "waiting" || current.erasedAt === undefined) {
    return rejected(state, "invalid-transition")
  }
  const record: NativeOutputRecord = {
    ...current,
    phase: "surrendered",
    surrenderedAt: input.now,
  }
  return applied(replaceOutput(state, record), { record })
}

export function markNativeOutputAccountingDisposition(
  state: NativeOutputState,
  input: {
    outputId: string
    disposition: Exclude<NativeOutputAccountingDisposition, "pending">
    now: number
  }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
  | NativeOutputRejected<"accounting-conflict">
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (!isNativeOutputTerminal(current) && current.phase !== "surrendered") {
    return rejected(state, "invalid-transition")
  }
  if (current.accountingDisposition !== "pending") {
    return current.accountingDisposition === input.disposition
      ? unchanged(state, { record: current })
      : rejected(state, "accounting-conflict")
  }
  const record: NativeOutputRecord = {
    ...current,
    accountingDisposition: input.disposition,
    accountingDispositionAt: input.now,
  }
  return applied(replaceOutput(state, record), { record })
}

export function markNativeOutputBlobReleased(
  state: NativeOutputState,
  input: { outputId: string; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (current.blobReleasedAt !== undefined) {
    return unchanged(state, { record: current })
  }
  if (
    !isNativeOutputAcceptanceProvenAbsent(current) &&
    (!isNativeOutputTerminal(current) ||
      current.accountingDisposition === "pending")
  ) {
    return rejected(state, "invalid-transition")
  }
  const record = { ...current, blobReleasedAt: input.now }
  return applied(replaceOutput(state, record), { record })
}

export function markNativeOutputDependencyReleased(
  state: NativeOutputState,
  input: { outputId: string; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ record: NativeOutputRecord }>
  | NativeOutputUnchanged<{ record: NativeOutputRecord }>
  | OutputNotFound
  | InvalidTransition
> {
  const current = state.outputsByOutputId[input.outputId]
  if (!current) return rejected(state, "output-not-found")
  if (current.dependencyReleasedAt !== undefined) {
    return unchanged(state, { record: current })
  }
  if (
    (!isNativeOutputTerminal(current) && current.phase !== "surrendered") ||
    current.accountingDisposition === "pending" ||
    current.blobReleasedAt === undefined
  ) {
    return rejected(state, "invalid-transition")
  }
  const record = { ...current, dependencyReleasedAt: input.now }
  return applied(replaceOutput(state, record), { record })
}

export function markNativeOutputJobDependencyReleased(
  state: NativeOutputState,
  input: { jobId: string; now: number }
): NativeOutputKernelDecision<
  | NativeOutputApplied<{ manifest: NativeOutputManifest }>
  | NativeOutputUnchanged<{ manifest: NativeOutputManifest }>
  | NativeOutputRejected<"manifest-not-found" | "invalid-transition">
> {
  const manifest = state.manifestsByJobId[input.jobId]
  if (!manifest) return rejected(state, "manifest-not-found")
  if (manifest.dependencyReleasedAt !== undefined) {
    return unchanged(state, { manifest })
  }
  const trackedOutputIds = manifest.slots.flatMap((slot) =>
    slot?.disposition === "tracked" ? [slot.outputId] : []
  )
  if (
    manifest.phase !== "sealed" ||
    trackedOutputIds.some((outputId) => {
      const record = state.outputsByOutputId[outputId]
      return record !== undefined && record.dependencyReleasedAt === undefined
    })
  ) {
    return rejected(state, "invalid-transition")
  }
  const released = { ...manifest, dependencyReleasedAt: input.now }
  return applied(replaceManifest(state, released), { manifest: released })
}
