export const STALL_TIMEOUT_MS = 30_000
export const HARD_TIMEOUT_MS = 150_000
export const OFFSCREEN_HEARTBEAT_INTERVAL_MS = 12_000
export const OFFSCREEN_JOB_LEASE_MS = 45_000
export const IPC_THROTTLE_MS = 250
export const TRANSITION_DURATION_MS = 275
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000
export const DEFAULT_IMAGE_TIMEOUT_MS = 30_000
export const DEFAULT_CHAPTER_TIMEOUT_MS = 5 * 60_000
export const ZIP_WORKER_FINALIZATION_TIMEOUT_MS = 5 * 60 * 1000
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024 // 100MB encoded payload limit per image
export const MAX_CHAPTER_IMAGES = 2_000
export const MAX_CHAPTER_IMAGE_BYTES = 512 * 1024 * 1024
export const MAX_METADATA_RESPONSE_BYTES = 10 * 1024 * 1024
// The ZIP worker retains compressed chunks and allocates one final contiguous
// transfer buffer, so the cap must account for roughly two copies at finalize.
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
export const MAX_IMAGE_DIMENSION_PX = 16_384
export const MAX_DECODED_IMAGE_PIXELS = 32 * 1024 * 1024
