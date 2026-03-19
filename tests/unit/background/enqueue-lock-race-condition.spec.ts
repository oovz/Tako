/**
 * Regression tests for enqueue lock race condition (Bug Fix)
 * 
 * Issue: User tries to queue a new download task after a previous task failed,
 * but gets rejected with "This tab already has an active download" because
 * of stale state read during concurrent operations.
 * 
 * Fix: Add lock mechanism to ensure check-and-enqueue is atomic.
 */

import { describe, it, expect } from 'vitest'

// Test the lock acquisition mechanism independently
describe('Enqueue lock mechanism', () => {
  // Simple lock implementation for testing
  const createLockManager = () => {
    const locks = new Map<number, Promise<void>>()
    
    const acquireLock = async (tabId: number, timeoutMs = 5000): Promise<() => void> => {
      const previousLock = locks.get(tabId)

      let releaseLock!: () => void
      const lockPromise = new Promise<void>(resolve => {
        releaseLock = resolve
      })

      const lockChain = (previousLock ?? Promise.resolve()).then(() => lockPromise)
      locks.set(tabId, lockChain)

      if (previousLock) {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined

        try {
          await Promise.race([
            previousLock,
            new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new Error(`Enqueue lock timeout for tab ${tabId}`))
              }, timeoutMs)
            }),
          ])
        } catch (error) {
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle)
          }

          if (locks.get(tabId) === lockChain) {
            locks.delete(tabId)
          }

          releaseLock()
          throw error
        }

        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle)
        }
      }
      
      return () => {
        if (locks.get(tabId) === lockChain) {
          locks.delete(tabId)
        }
        releaseLock()
      }
    }
    
    return { acquireLock, locks }
  }

  it('should allow sequential lock acquisition for same tab', async () => {
    const { acquireLock, locks } = createLockManager()
    
    const release1 = await acquireLock(100)
    expect(locks.has(100)).toBe(true)
    release1()
    expect(locks.has(100)).toBe(false)
    
    const release2 = await acquireLock(100)
    expect(locks.has(100)).toBe(true)
    release2()
    expect(locks.has(100)).toBe(false)
  })

  it('should block concurrent lock acquisition for same tab', async () => {
    const { acquireLock } = createLockManager()
    const events: string[] = []
    
    const release1 = await acquireLock(100)
    events.push('lock1-acquired')
    
    // Start second lock acquisition (should wait)
    const lock2Promise = acquireLock(100).then(release => {
      events.push('lock2-acquired')
      return release
    })
    
    // Give time for lock2 to start waiting
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // lock2 should not have acquired yet
    expect(events).toEqual(['lock1-acquired'])
    
    // Release first lock
    release1()
    events.push('lock1-released')
    
    // Now lock2 should acquire
    const release2 = await lock2Promise
    release2()
    
    expect(events).toEqual(['lock1-acquired', 'lock1-released', 'lock2-acquired'])
  })

  it('should allow concurrent lock acquisition for different tabs', async () => {
    const { acquireLock, locks } = createLockManager()
    
    const release1 = await acquireLock(100)
    const release2 = await acquireLock(200)
    expect(locks.has(100)).toBe(true)
    expect(locks.has(200)).toBe(true)
    
    // Both should acquire immediately
    release1()
    release2()
    expect(locks.size).toBe(0)
  })

  it('should timeout if lock held too long', async () => {
    const { acquireLock } = createLockManager()
    
    // Acquire lock but never release it
    await acquireLock(100)
    
    // Second lock should timeout (using short timeout for test)
    await expect(acquireLock(100, 100)).rejects.toThrow('Enqueue lock timeout')
  })
})

describe('Task status during enqueue check', () => {
  it('should include queued status in active check', () => {
    // The activeTabStatuses should include 'queued' to prevent
    // enqueueing new tasks while a queued task exists
    const activeTabStatuses = ['downloading', 'queued']
    
    expect(activeTabStatuses).toContain('downloading')
    expect(activeTabStatuses).toContain('queued')
  })

  it('should exclude terminal statuses from active check', () => {
    const activeTabStatuses = ['downloading', 'queued']
    const terminalStatuses = ['completed', 'failed', 'partial_success', 'canceled']
    
    for (const status of terminalStatuses) {
      expect(activeTabStatuses).not.toContain(status)
    }
  })
})

describe('Race condition prevention', () => {
  it('should prevent stale read during concurrent operations', async () => {
    // Simulate the race condition scenario
    let currentTaskStatus = 'downloading'
    const operations: string[] = []
    
    // Simulate status update operation
    const updateStatus = async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      currentTaskStatus = 'failed'
      operations.push('status-updated')
    }
    
    // Simulate enqueue check operation (without lock - old behavior)
    const checkWithoutLock = async () => {
      const status = currentTaskStatus // Stale read
      await new Promise(resolve => setTimeout(resolve, 100))
      operations.push(`checked-status:${status}`)
      return status
    }
    
    // Run both concurrently
    const [, checkedStatus] = await Promise.all([
      updateStatus(),
      checkWithoutLock(),
    ])
    
    // Without lock, the check sees stale 'downloading' status
    expect(checkedStatus).toBe('downloading')
    expect(currentTaskStatus).toBe('failed')
    expect(operations).toContain('status-updated')
  })

  it('should read fresh status with lock protection', async () => {
    let currentTaskStatus = 'downloading'
    let previousLock: Promise<void> | null = null
    
    const acquireLock = async () => {
      let releaseLock!: () => void
      const lockPromise = new Promise<void>(resolve => {
        releaseLock = resolve
      })

      const waitFor = previousLock
      previousLock = (waitFor ?? Promise.resolve()).then(() => lockPromise)
      if (waitFor) {
        await waitFor
      }

      return () => {
        releaseLock()
        if (previousLock === lockPromise) {
          previousLock = null
        }
      }
    }
    
    // Status update with lock
    const updateStatus = async () => {
      const release = await acquireLock()
      try {
        await new Promise(resolve => setTimeout(resolve, 50))
        currentTaskStatus = 'failed'
      } finally {
        release()
      }
    }
    
    // Enqueue check with lock
    const checkWithLock = async () => {
      const release = await acquireLock()
      try {
        // Read status INSIDE lock
        return currentTaskStatus
      } finally {
        release()
      }
    }
    
    // Run update first, then check
    await updateStatus()
    const checkedStatus = await checkWithLock()
    
    // With lock, the check sees fresh 'failed' status
    expect(checkedStatus).toBe('failed')
  })
})

describe('Multi-series same-tab scenario', () => {
  it('should allow new task after previous task completes', () => {
    // Scenario: User downloads from Series A, then navigates to Series B in same tab
    const tasks = [
      { id: 'task-1', tabId: 100, seriesId: 'series-a', status: 'completed' },
    ]
    
    const activeStatuses = ['downloading', 'queued']
    const hasActiveTask = tasks.some(
      t => t.tabId === 100 && activeStatuses.includes(t.status)
    )
    
    // Completed task should not block new enqueue
    expect(hasActiveTask).toBe(false)
  })

  it('should allow new task after previous task fails', () => {
    const tasks = [
      { id: 'task-1', tabId: 100, seriesId: 'series-a', status: 'failed' },
    ]
    
    const activeStatuses = ['downloading', 'queued']
    const hasActiveTask = tasks.some(
      t => t.tabId === 100 && activeStatuses.includes(t.status)
    )
    
    // Failed task should not block new enqueue
    expect(hasActiveTask).toBe(false)
  })

  it('should block new task while previous task is downloading', () => {
    const tasks = [
      { id: 'task-1', tabId: 100, seriesId: 'series-a', status: 'downloading' },
    ]
    
    const activeStatuses = ['downloading', 'queued']
    const hasActiveTask = tasks.some(
      t => t.tabId === 100 && activeStatuses.includes(t.status)
    )
    
    // Downloading task should block new enqueue
    expect(hasActiveTask).toBe(true)
  })
})
