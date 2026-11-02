import { assertKnownSiteIntegrationIds } from "./site-integration-document-validation"
import type { StorageMutationQueue } from "./storage-mutation-queue"

export async function updateSiteIntegrationDocument<T extends object>(
  siteId: string,
  updates: T,
  documentName: string,
  mutations: StorageMutationQueue,
  read: () => Promise<Record<string, T>>,
  persist: (document: Record<string, T>) => Promise<void>
): Promise<void> {
  assertKnownSiteIntegrationIds({ [siteId]: {} }, documentName)
  await mutations.run(async () => {
    const current = await read()
    current[siteId] = { ...(current[siteId] || {}), ...updates }
    await persist(current)
  })
}
