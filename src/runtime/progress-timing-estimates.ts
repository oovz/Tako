import {
  getInitialProgressPhaseCosts,
  toPipelineProgressPhase,
  type PipelineProgressPhase,
  type ProgressCostContext,
  type ProgressPhaseCostProfile,
} from "@/src/runtime/progress-calculator"
import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { isRecord } from "@/src/shared/type-guards"
import type { OffscreenJobStage } from "@/src/domain/queue/state"
import { getDefinition } from "@/src/site-integrations/catalog"

const EWMA_ALPHA = 0.25
const MIN_SAMPLE_MS = 50
const MAX_SAMPLE_MS = 10 * 60_000

type PersistedProgressTimingEstimates = Record<string, number>

function normalizeEstimates(raw: unknown): PersistedProgressTimingEstimates {
  if (!isRecord(raw)) return {}
  const estimates: PersistedProgressTimingEstimates = {}
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= MIN_SAMPLE_MS &&
      value <= MAX_SAMPLE_MS
    ) {
      estimates[key] = value
    }
  }
  return estimates
}

function transformType(context: ProgressCostContext): string {
  return (
    getDefinition(context.integrationId)?.resolution.imageTransform.kind ??
    "none"
  )
}

export function progressTimingEstimateKey(
  context: ProgressCostContext,
  phase: PipelineProgressPhase
): string {
  return [
    context.integrationId,
    phase,
    context.archiveFormat,
    context.destination,
    transformType(context),
  ].join("|")
}

interface ActivePhaseSample {
  phase: PipelineProgressPhase
  startedAt: number
  context: ProgressCostContext
}

export class ProgressTimingEstimator {
  private estimates: PersistedProgressTimingEstimates | null = null
  private activeSamples = new Map<string, ActivePhaseSample>()

  private async getEstimates(): Promise<PersistedProgressTimingEstimates> {
    if (this.estimates) return this.estimates
    try {
      const stored = await chrome.storage.local.get(
        LOCAL_STORAGE_KEYS.progressTimingEstimates
      )
      this.estimates = normalizeEstimates(
        stored[LOCAL_STORAGE_KEYS.progressTimingEstimates]
      )
    } catch (error) {
      // Timing history only improves an estimate. A storage outage must not
      // interrupt a download or suppress its live progress events.
      logger.debug(
        "Unable to read progress timing estimates (non-fatal):",
        error
      )
      this.estimates = {}
    }
    return this.estimates
  }

  async getCosts(
    context: ProgressCostContext
  ): Promise<ProgressPhaseCostProfile> {
    const defaults = getInitialProgressPhaseCosts(context)
    const estimates = await this.getEstimates()
    const phases = Object.keys(defaults) as PipelineProgressPhase[]
    return Object.fromEntries(
      phases.map((phase) => [
        phase,
        estimates[progressTimingEstimateKey(context, phase)] ?? defaults[phase],
      ])
    ) as ProgressPhaseCostProfile
  }

  private async recordSample(
    sample: ActivePhaseSample,
    endedAt: number
  ): Promise<void> {
    const elapsed = Math.min(
      MAX_SAMPLE_MS,
      Math.max(0, endedAt - sample.startedAt)
    )
    if (elapsed < MIN_SAMPLE_MS) return

    const estimates = await this.getEstimates()
    const key = progressTimingEstimateKey(sample.context, sample.phase)
    const previous = estimates[key]
    estimates[key] = previous
      ? previous * (1 - EWMA_ALPHA) + elapsed * EWMA_ALPHA
      : elapsed
    try {
      await chrome.storage.local.set({
        [LOCAL_STORAGE_KEYS.progressTimingEstimates]: { ...estimates },
      })
    } catch (error) {
      logger.debug(
        "Unable to persist progress timing estimate (non-fatal):",
        error
      )
    }
  }

  async observe(input: {
    jobId: string
    stage: OffscreenJobStage
    context: ProgressCostContext
    now?: number
  }): Promise<ProgressPhaseCostProfile> {
    const now = input.now ?? Date.now()
    const phase = toPipelineProgressPhase(input.stage)
    const previous = this.activeSamples.get(input.jobId)
    if (previous && previous.phase !== phase) {
      await this.recordSample(previous, now)
    }
    if (!previous || previous.phase !== phase) {
      this.activeSamples.set(input.jobId, {
        phase,
        startedAt: now,
        context: input.context,
      })
    }
    return await this.getCosts(input.context)
  }

  async finish(jobId: string, now: number = Date.now()): Promise<void> {
    const sample = this.activeSamples.get(jobId)
    if (!sample) return
    this.activeSamples.delete(jobId)
    await this.recordSample(sample, now)
  }
}

export const progressTimingEstimator = new ProgressTimingEstimator()
