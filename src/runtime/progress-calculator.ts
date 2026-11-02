import { getDefinition } from "@/src/site-integrations/catalog"

export type PipelineProgressPhase =
  "resolving" | "downloading" | "transforming" | "archiving" | "saving"

export type ProgressPhaseCostProfile = Record<PipelineProgressPhase, number>

export interface ProgressCostContext {
  integrationId: string
  archiveFormat: "cbz" | "zip" | "none"
  destination: "downloads-api" | "file-system-access"
}

export function getInitialProgressPhaseCosts(
  context: ProgressCostContext
): ProgressPhaseCostProfile {
  const transform = getDefinition(context.integrationId)?.imageTransform
  const integratedTransformCost =
    transform?.kind === "integrated-descramble" ? transform.estimatedCostMs : 0
  return {
    resolving: 800,
    // Current adapters report an image only after any descrambling has
    // finished, so this is one measurable composite phase.
    downloading: 8_000 + integratedTransformCost,
    transforming: 0,
    archiving: context.archiveFormat === "none" ? 0 : 2_500,
    saving: context.destination === "file-system-access" ? 1_500 : 1_000,
  }
}

export function toPipelineProgressPhase(
  stage:
    | "dispatching"
    | "accepted"
    | "resolving"
    | "downloading"
    | "transforming"
    | "archiving"
    | "saving"
): PipelineProgressPhase {
  return stage === "dispatching" || stage === "accepted" ? "resolving" : stage
}

export function calculatePhaseWeightedChapterFraction(input: {
  costs: ProgressPhaseCostProfile
  stage: Parameters<typeof toPipelineProgressPhase>[0]
  phaseFraction: number
}): number {
  const phase = toPipelineProgressPhase(input.stage)
  const boundedFraction = clamp(input.phaseFraction, 0, 1)
  const totalCost = Object.values(input.costs).reduce(
    (sum, cost) => sum + Math.max(0, cost),
    0
  )
  if (totalCost <= 0) return boundedFraction

  const phaseOrder: PipelineProgressPhase[] = [
    "resolving",
    "downloading",
    "transforming",
    "archiving",
    "saving",
  ]
  let completedCost = 0
  for (const candidate of phaseOrder) {
    const cost = Math.max(0, input.costs[candidate])
    if (candidate === phase) {
      completedCost += cost * boundedFraction
      break
    }
    completedCost += cost
  }

  return clamp(completedCost / totalCost, 0, 1)
}

export function calculateTimeWeightedTaskFraction(input: {
  totalChapters: number
  settledChapters: number
  activeChapterFractions: number[]
  previousDisplayedFraction?: number
  destinationCommitted: boolean
}): number {
  const totalChapters = Math.max(1, Math.floor(input.totalChapters))
  const rawFraction = clamp(
    (Math.max(0, input.settledChapters) +
      input.activeChapterFractions.reduce(
        (sum, fraction) => sum + clamp(fraction, 0, 1),
        0
      )) /
      totalChapters,
    0,
    1
  )
  const monotonicFraction = Math.max(
    clamp(input.previousDisplayedFraction ?? 0, 0, 1),
    rawFraction
  )
  return input.destinationCommitted
    ? monotonicFraction
    : Math.min(monotonicFraction, 0.99)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
