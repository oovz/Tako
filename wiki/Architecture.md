# Architecture

Tako is a WXT Manifest V3 extension targeting Chrome 150. It separates durable control from long-running data work so Service Worker suspension cannot silently lose or duplicate a download.

## Runtime boundaries

```mermaid
flowchart TD
  UI["Side Panel / Options"]
  SW["Service Worker — durable control plane"]
  OS["Offscreen document — data plane"]
  WK["Bundled workers"]
  PAGE["Supported page — optional one-shot probe"]
  CHROME["Chrome Downloads"]
  FSA["File System Access"]

  UI -->|"idempotent commands"| SW
  SW -->|"session projections + active-progress Port"| UI
  SW -->|"jobId + attempt"| OS
  OS -->|"accepted / heartbeat / progress / output"| SW
  OS --> WK
  SW -->|"executeScript only when needed"| PAGE
  OS -->|"Blob output"| SW
  SW --> CHROME
  OS --> FSA
```

### Side Panel and Options

- Present data and forms; never mutate durable queue state directly.
- Read queue, context, destination issues, and recovery state from `chrome.storage.session` projections.
- Open a named `runtime.Port` only for high-frequency active-task progress; reconnects fall back to the latest session snapshot.
- Include `windowId`, `tabId`, request/command identity, and expected revision where applicable.
- Keep the current Side Panel layout: inline chapter selector, unified nonterminal queue with the active task first, and separate recent history.

### Service Worker

- Registers Chrome event listeners synchronously at module load.
- Serializes commands and is the only durable queue/task-state mutator.
- Persists intent before effects: queue transitions, dispatch lease, pending native output, destination issues, Undo actions, and provider dispatch deadline.
- Owns privileged Chrome APIs: downloads, permissions, alarms, notifications, badge, scripting, and offscreen lifecycle.
- Resolves safe series metadata through provider APIs or fetched HTML when the provider declares background dispatch capability.
- Reconciles current offscreen job and native downloads on every initialization.

### Offscreen document

- Owns chapter/image requests, offscreen-only provider parsing, per-origin scheduling, retry timers, transforms/descrambling, archive creation, FSA writes, and Blob URLs.
- Communicates through `chrome.runtime`; other extension APIs remain in the Service Worker.
- Emits job acceptance and a dedicated heartbeat independent from progress.
- Uses bundled workers for CPU-heavy compression/transforms when appropriate.
- Renderer-heavy provider transforms share an abortable weighted pixel budget; network fetches remain outside that admission and the existing per-image decoded-pixel limit remains the budget envelope.
- Stays alive while Chrome still reads a Blob-backed output.

### Page probe

There is no resident content script by default. Active-tab context resolves in this order:

1. URL parsing.
2. Provider API.
3. Fetched provider HTML parsed in extension/offscreen context.
4. A bundled, read-only, isolated-world one-shot `chrome.scripting.executeScript` probe only for live DOM or page-owned storage.

The probe returns schema-validated plain data, accepts no remote code/selectors, installs no listener/timer, and cannot write extension storage or operate the queue. Main-world execution requires an integration-specific reason.

## Durable job protocol

Every chapter attempt has a stable `jobId` and monotonic `attempt`.

```text
SW persists dispatch lease
  → SW sends START_JOB
  → offscreen sends JOB_ACCEPTED
  → offscreen sends HEARTBEAT and phase progress
  → offscreen prepares/writes requested outputs
  → SW/offscreen commit destination results
  → SW persists chapter/task outcome
  → SW clears lease and dispatches next eligible work
```

The offscreen document rejects duplicate/stale jobs. Duplicate UI commands and output handoffs return their prior result. On Service Worker wake:

1. Hydrate durable state.
2. Check `chrome.offscreen.hasDocument()`.
3. Query its current job.
4. Reconcile `jobId`/`attempt`, pending native output, and lease.
5. Resume observation, replay idempotently, or mark only unrecoverable work interrupted.

The watchdog alarm uses `persistAcrossSessions: true` and is verified/recreated at initialization. It is armed for executing offscreen work or an active offscreen dispatch lease, not merely for a Chrome-owned download. Multiple missed heartbeats trigger `QUERY_JOB` before any recovery teardown. Native download completion is event-driven through `downloads.onChanged`. Startup-after-worker-loss reconciles missed events and prepared handoffs; live repair revisits only ambiguous acceptance or explicit cleanup/accounting work. Known long-running Chrome downloads are not age-failed by the watchdog.

## Output transaction

“Completed” means usable output exists at the requested destination.

### Chrome Downloads

1. Offscreen creates a Blob URL and sends `OUTPUT_READY` with task, chapter, job, attempt, and output identity.
2. Service Worker persists a prepared output record, then durably records `handoffStartedAt` immediately before calling `chrome.downloads.download()`.
3. A numeric `downloadId` means Chrome successfully started the download. Tako keeps that ID observable even if the following local-storage write fails; the prepared record and handoff marker remain restart-reconcilable by Blob URL.
4. Service Worker observes `downloads.onChanged` and reconciles the durable ID with `chrome.downloads.search()` after startup or a transient storage failure.
5. `complete` commits the output; `interrupted` records a typed output failure.
6. Service Worker tells offscreen to revoke the Blob URL after terminal state.

The durable output states are:

| State                              | Meaning                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `prepared` / `prepared_before_api` | The API has not been called; startup may classify a missing history item as rejected.                                            |
| `prepared` / `handoff_started`     | API acceptance is unknown; a missing history item is not proof of rejection, so the Blob remains owned and recovery stays armed. |
| `in_progress` with `downloadId`    | Chrome accepted the handoff; completion is still pending.                                                                        |
| `erased`                           | Chrome removed history; transfer outcome remains unknown while the owner exists.                                                 |
| `complete` or `interrupted`        | Positive terminal transfer evidence has been recorded.                                                                           |
| `accountedAt` set                  | The terminal result has been projected into queue accounting.                                                                    |
| `blobRevokedAt` set                | The offscreen Blob dependency has been released.                                                                                 |

`downloads.onErased` only means that Chrome removed the download from history; it is not a transfer outcome. Tako records that the native result is currently unobservable (`erasedAt` on a `waiting` output), keeps the chapter and output identity pending, and keeps the offscreen Blob owner alive. A later `complete`/`interrupted` observation is authoritative and is projected into output accounting; erasure alone never determines success or failure. The task is durably blocked with `activeBlock: "native_output_action_required"` and the `browser_download_unobservable` category, so the queue stops dispatching it and the Side Panel renders the browser-download-unobservable message. The user-facing cancel confirmation becomes an explicit task-wide “forget all pending downloads” action in this state (`FORGET_UNOBSERVABLE_OUTPUTS`); it surrenders every waiting output whose Chrome history entry was erased, revokes every pending Blob owned by the affected job(s), releases queue accounting without claiming Chrome completion or interruption, and lets the queue continue. Canceling such a task performs this surrender as part of its best-effort cleanup routine.

A pending native download is a durable wait state, not a liveness failure. Tako does not poll known long-running Chrome downloads with the offscreen watchdog, and it stops arming the liveness alarm for erased downloads once the task block is in place: the durable `native_output_action_required` block is itself the recovery marker after a Service Worker restart.

### Cancellation, cleanup, and restart recovery

Canceling a task durably records its canceled status in storage to prevent further chapter dispatch and uncommitted pipeline work. It does not cancel native downloads already accepted by Chrome.

Following durable cancellation, resource cleanup proceeds on a best-effort basis:

1. **Producer cancellation** — Tako instructs the offscreen document to abort in-flight image fetches and compression. If the producer cannot converge immediately (e.g. during an MV3 messaging boundary transition), the active lease is quarantined and watchdog alarms remain armed so the worker can retry or recover cleanly.
2. **Native output cleanup** — Tako seals open output manifests, surrenders unobservable erased outputs, and revokes owned Blob URLs. Transient errors during native output cleanup are logged for later reconciliation and do not block the task's terminal cancellation state.
3. **Restart recovery** — Any residual leases, unrevoked Blobs, or unobservable outputs are safely swept and reconciled during Service Worker startup or subsequent watchdog alarms.

For an unobservable history entry, the explicit task-wide forget action provides the user-directed recovery path; it releases Tako's Blob ownership for every pending sibling in the affected job and forgets that job rather than asserting a Chrome transfer result.

### File System Access

The task's destination is snapshotted at enqueue. Before promotion, Tako checks capability, handle presence, and `queryPermission({mode:'readwrite'})`. A write commits only after the writable stream closes successfully.

Unsupported, prompt/denied, missing-folder, write, or disk-full failures persist a `DestinationIssue`, block further dispatch, and show repair actions. The queue transition and destination-issue mutation use one durable local-storage commit, followed by best-effort session projection and notification. Tako never silently changes the destination. The user can explicitly re-grant, reselect, continue that task in Downloads, or cancel.

Both destinations use one `uniquify | overwrite` collision policy; `uniquify` is the default.

## Task and chapter outcomes

```typescript
type TaskStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "partial_success"
  | "failed"
  | "canceled"

type ChapterStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "partial_success"
  | "failed"
  | "canceled"
  | "skipped"
```

- `completed`: every requested output committed.
- `partial_success`: some usable requested output committed, but the request is incomplete. Partially saved loose images count even if no whole chapter did.
- `failed`: no usable requested output committed.
- On cancellation, the active uncommitted chapter becomes `canceled`, remaining queued chapters become `skipped`, and terminal chapter outcomes remain.

There is no Pause state. A destination prerequisite is an external action-required block, not Pause.

## Progress

Offscreen reports resolving, downloading, transforming, archiving, and saving stages. Live updates use the Side Panel Port; session storage keeps a bounded-cadence latest snapshot for reconnect.

Overall percentage is weighted by locally learned phase duration using provider, transform type, bytes/pixels, archive format, and destination. It is monotonic, does not fabricate progress from elapsed time alone, and remains below 100% until destination commit.

## Storage ownership

| Store                    | Canonical data                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chrome.storage.local`   | queue/history, settings, queue revision, dispatch lease, pending native output identity, destination issues, pending Undo actions, and migration epoch |
| `chrome.storage.session` | current queue/history/context/progress recovery snapshots                                                                                              |
| IndexedDB                | selected `FileSystemDirectoryHandle` only                                                                                                              |
| Runtime Port             | high-frequency active-task progress only                                                                                                               |
| React state              | component/view state and chapter selection drafts for current UI interactions                                                                          |

Large Blobs are never stored in Chrome storage.

## Site integrations

Each provider `definition.json` declares identity, contributors, version, shipped/default state, match patterns, required/optional origins, page-probe mode, capabilities, rate/timeout policies, endpoint policies, dynamic origins, DNR session referer rules, fixtures, and custom settings. The JSON is validated against `definition.schema.json` and emitted into generated catalogs and context-specific registries.

The current bundled integrations are MangaDex, Pixiv Comic, Shonen Jump+, Manhuagui, Comic Nettai, and MangaMillion. MangaDex is disabled by default. Enabling it from Options requests optional `https://*/*` access for dynamic MangaDex@Home nodes. Runtime URL policy remains narrow even after Chrome grants that broad permission.

Provider request paths use the shared hardened layer when they delegate to it; provider-owned request roles retain their own explicit credential, origin, and retry policy. The shared layer provides HTTPS and origin policy, pre-follow redirect rejection, defensive final-URL validation, private/loopback rejection unless explicitly approved, response limits, abort signals, and raw response header-MIME/size validation. Image transformation paths additionally validate encoded signatures and dimensions before decoding; all transformation paths reject AVIF until bounded support exists. Filename sanitization and structured retry/error classification apply at their respective boundaries.

## Error and diagnostic boundary

The UI shows localized plain-language categories. It never displays raw browser errors, stack traces, signed URLs, headers, or provider bodies. Technical detail goes to redacted extension console diagnostics. `runtime.lastError.message` is not parsed because Chrome does not define it as a stable machine-readable API.

## References

- [Chrome extensions Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
