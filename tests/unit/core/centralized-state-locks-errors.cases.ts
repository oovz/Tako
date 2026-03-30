import { describe, expect, it, vi } from 'vitest';

export function registerCentralizedStateLockAndErrorCases(): void {
  describe('Lock Management', () => {
    it('allows sequential lock acquisition for the same key', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      const acquireLock = (stateManager as unknown as { acquireLock: (lockKey: string, timeoutMs?: number) => Promise<() => void> }).acquireLock.bind(stateManager);

      const release1 = await acquireLock('global_state_mutation');
      release1();

      const release2 = await acquireLock('global_state_mutation');
      release2();
    });

    it('serializes concurrent lock acquisition for the same key', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      const acquireLock = (stateManager as unknown as { acquireLock: (lockKey: string, timeoutMs?: number) => Promise<() => void> }).acquireLock.bind(stateManager);
      const events: string[] = [];

      const release1 = await acquireLock('global_state_mutation');
      events.push('lock1-acquired');

      const lock2Promise = acquireLock('global_state_mutation').then((release: () => void) => {
        events.push('lock2-acquired');
        return release;
      });

      await Promise.resolve();
      events.push('before-release1');
      release1();

      const release2 = await lock2Promise;
      events.push('after-lock2');
      release2();

      expect(events).toEqual([
        'lock1-acquired',
        'before-release1',
        'lock2-acquired',
        'after-lock2',
      ]);
    });

    it('times out when a lock is held too long', async () => {
      vi.useFakeTimers();

      try {
        const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

        const stateManager = new CentralizedStateManager();
        const acquireLock = (stateManager as unknown as { acquireLock: (lockKey: string, timeoutMs?: number) => Promise<() => void> }).acquireLock.bind(stateManager);

        await acquireLock('global_state_mutation');

        const waitingLock = acquireLock('global_state_mutation', 100);
        const rejection = expect(waitingLock).rejects.toThrow('Lock timeout: global_state_mutation');
        await vi.advanceTimersByTimeAsync(100);

        await rejection;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Error Handling', () => {
    it('throws error when created without chrome.storage', async () => {
      const originalChrome = globalThis.chrome;
      // @ts-expect-error Testing error condition
      globalThis.chrome = undefined;

      await expect(async () => {
        const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
        new CentralizedStateManager();
      }).rejects.toThrow();

      globalThis.chrome = originalChrome;
    });

    it('handles initialization failure gracefully', async () => {
      const originalSetAccessLevel = chrome.storage.session.setAccessLevel;
      vi.mocked(chrome.storage.session.setAccessLevel).mockRejectedValueOnce(new Error('Storage error'));

      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      const stateManager = new CentralizedStateManager();

      await expect(stateManager.initialize()).rejects.toThrow('Storage error');

      chrome.storage.session.setAccessLevel = originalSetAccessLevel;
    });
  });
}
