import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import type { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { ProviderNetworkPolicyContinuationCoordinator } from "@/src/site-integrations/provider-network-policy-continuation"

const policy = vi.hoisted(() => ({
  clear: vi.fn(),
  read: vi.fn(),
  current: vi.fn(() => true),
}))

describe("ProviderPolicyQueueCoordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    policy.read.mockResolvedValue({ revision: 4, consumed: false })
  })

  it("does not fail an admitted task when continuation acknowledgement fails", async () => {
    const queueRepository = {
      releaseProviderPolicyBlocks: vi.fn(async () => ({ outcome: "applied" })),
      getQueue: vi.fn(async () => [
        { id: "task-1", status: "queued", activeBlock: undefined },
      ]),
    } as unknown as QueueRepository
    const nativeOutputCoordinator = {
      armLiveness: vi.fn(async () => undefined),
    } as unknown as NativeOutputCoordinator
    const continuation = {
      clearContinuation: policy.clear,
      readContinuation: policy.read,
      isContinuationCurrent: policy.current,
    }
    const coordinator = new ProviderPolicyQueueCoordinator(
      queueRepository,
      nativeOutputCoordinator,
      {} as DownloadTaskCancellationCoordinator,
      continuation as unknown as ProviderNetworkPolicyContinuationCoordinator
    )
    policy.clear.mockRejectedValueOnce(new Error("session storage failed"))

    await coordinator.resumeBlockedQueue()
    await expect(
      coordinator.acknowledgeAfterAdmission()
    ).resolves.toBeUndefined()

    expect(nativeOutputCoordinator.armLiveness).toHaveBeenCalledOnce()
    policy.clear.mockResolvedValueOnce(undefined)
    await coordinator.acknowledgeAfterAdmission()
    await coordinator.acknowledgeAfterAdmission()
    expect(policy.clear).toHaveBeenCalledTimes(2)
  })
})
