/**
 * Serializes read-modify-write operations for one logical storage document.
 * A rejected mutation does not poison later work.
 */
export class StorageMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
