import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureLivenessAlarm, LIVENESS_ALARM_NAME, recordOffscreenActivity } from '@/entrypoints/background/offscreen-lifecycle';
import { LIVENESS_TIMEOUT_MS } from '@/src/constants/timeouts';
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';

describe('offscreen liveness activity behavior', () => {
  const alarmsCreate = vi.fn(async () => {});
  const storageSessionSet = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('chrome', {
      alarms: {
        create: alarmsCreate,
      },
      storage: {
        session: {
          set: storageSessionSet,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the liveness alarm at 30-second interval', async () => {
    await ensureLivenessAlarm();

    expect(alarmsCreate).toHaveBeenCalledWith(LIVENESS_ALARM_NAME, {
      periodInMinutes: 0.5,
    });
  });

  it('records offscreen activity timestamp into session storage', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456_789);

    await recordOffscreenActivity();

    expect(storageSessionSet).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.lastOffscreenActivity]: 123_456_789,
    });

    nowSpy.mockRestore();
  });
});

describe('liveness timeout constants', () => {
  it('uses a 60-second timeout threshold', () => {
    expect(LIVENESS_TIMEOUT_MS).toBe(60_000);
  });

  it('keeps timeout greater than the 30-second liveness alarm interval', () => {
    const livenessAlarmIntervalMs = 30_000;
    expect(LIVENESS_TIMEOUT_MS).toBeGreaterThan(livenessAlarmIntervalMs);
    expect(LIVENESS_TIMEOUT_MS).toBe(livenessAlarmIntervalMs * 2);
  });
});

