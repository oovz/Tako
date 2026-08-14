export type BackgroundRuntimePhase =
  | "internal-state-ready"
  | "queue-hydrated"
  | "integrations-ready"
  | "runtime-ready"

export class InvalidDurableStateError extends Error {
  readonly fatal = true

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "InvalidDurableStateError"
  }
}

export class RuntimePhaseError extends Error {
  constructor(
    readonly phase: BackgroundRuntimePhase,
    readonly fatal: boolean,
    cause: unknown
  ) {
    super(
      cause instanceof Error
        ? cause.message
        : `Background runtime phase failed: ${phase}`,
      { cause }
    )
    this.name = "RuntimePhaseError"
  }
}

export function isFatalRuntimeInitializationError(error: unknown): boolean {
  return (
    error instanceof InvalidDurableStateError ||
    (error instanceof RuntimePhaseError && error.fatal)
  )
}
