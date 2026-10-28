import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"

const destinationAccess = new StorageMutationQueue()

/** Keep saved capabilities alive until offscreen captures the dispatch handle. */
export function runDestinationAccessExclusive<T>(
  operation: () => Promise<T>
): Promise<T> {
  return destinationAccess.run(operation)
}
