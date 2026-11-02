import { KeyedSerialExecutor } from "@/src/runtime/keyed-serial-executor"

const taskSideEffects = new KeyedSerialExecutor()

/**
 * Serialize cancellation and irreversible output handoff for one task within a
 * service-worker lifetime. Durable task/lease checks still fence restarts; this
 * gate closes the local check-to-side-effect race between those writes.
 */
export function runTaskSideEffectExclusive<T>(
  taskId: string,
  operation: () => Promise<T>
): Promise<T> {
  return taskSideEffects.run(taskId, operation)
}
