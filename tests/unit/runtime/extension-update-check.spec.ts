import { describe, expect, it, vi } from 'vitest'

import {
  checkForChromeWebStoreUpdate,
  getChromeWebStoreUpdateStatusCopy,
  reloadExtensionForUpdate,
  type ExtensionUpdateRuntime,
} from '@/src/runtime/extension-update-check'

function updateResult(
  status: chrome.runtime.RequestUpdateCheckStatus,
  version = '',
): Partial<chrome.runtime.RequestUpdateCheckResult> {
  return { status, version }
}

function makeRuntime(overrides: Partial<ExtensionUpdateRuntime> = {}): ExtensionUpdateRuntime {
  return {
    getManifest: () => ({ version: '1.2.7' }),
    requestUpdateCheck: vi.fn(async () => updateResult('no_update')),
    reload: vi.fn(),
    ...overrides,
  }
}

describe('checkForChromeWebStoreUpdate', () => {
  it('reports no_update with the installed extension version', async () => {
    const runtime = makeRuntime({
      requestUpdateCheck: vi.fn(async () => updateResult('no_update')),
    })

    await expect(checkForChromeWebStoreUpdate({ runtime, now: () => 1234 })).resolves.toEqual({
      ok: true,
      status: 'no_update',
      currentVersion: '1.2.7',
      checkedAt: 1234,
    })
    expect(runtime.requestUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it('reports update_available with the Chrome Web Store version', async () => {
    const runtime = makeRuntime({
      requestUpdateCheck: vi.fn(async () => updateResult('update_available', '1.2.8')),
    })

    await expect(checkForChromeWebStoreUpdate({ runtime, now: () => 5678 })).resolves.toEqual({
      ok: true,
      status: 'update_available',
      currentVersion: '1.2.7',
      availableVersion: '1.2.8',
      checkedAt: 5678,
    })
  })

  it('surfaces Chrome throttling without retry loops', async () => {
    const runtime = makeRuntime({
      requestUpdateCheck: vi.fn(async () => updateResult('throttled')),
    })

    const result = await checkForChromeWebStoreUpdate({ runtime, now: () => 91011 })

    expect(result).toEqual({
      ok: true,
      status: 'throttled',
      currentVersion: '1.2.7',
      checkedAt: 91011,
    })
    expect(runtime.requestUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it('returns unsupported when the browser runtime does not expose requestUpdateCheck', async () => {
    const runtime = makeRuntime({ requestUpdateCheck: undefined })

    await expect(checkForChromeWebStoreUpdate({ runtime, now: () => 1213 })).resolves.toEqual({
      ok: false,
      status: 'unsupported',
      currentVersion: '1.2.7',
      checkedAt: 1213,
      error: 'Chrome Web Store update checks are only available in Chromium extension runtimes.',
    })
  })

  it('returns an error result when Chrome rejects the update check', async () => {
    const runtime = makeRuntime({
      requestUpdateCheck: vi.fn(async () => {
        throw new Error('Updates are not available for unpacked extensions')
      }),
    })

    await expect(checkForChromeWebStoreUpdate({ runtime, now: () => 1415 })).resolves.toEqual({
      ok: false,
      status: 'error',
      currentVersion: '1.2.7',
      checkedAt: 1415,
      error: 'Updates are not available for unpacked extensions',
    })
  })
})

describe('getChromeWebStoreUpdateStatusCopy', () => {
  it('formats user-facing copy for each update-check outcome', () => {
    expect(getChromeWebStoreUpdateStatusCopy({
      ok: true,
      status: 'no_update',
      currentVersion: '1.2.7',
      checkedAt: 1,
    })).toEqual({
      tone: 'neutral',
      title: 'No Update Available',
      description: 'Chrome did not return an installable update for version 1.2.7. This does not compare unpacked or locally modified builds against the public Web Store listing.',
    })

    expect(getChromeWebStoreUpdateStatusCopy({
      ok: true,
      status: 'update_available',
      currentVersion: '1.2.7',
      availableVersion: '1.2.8',
      checkedAt: 1,
    })).toEqual({
      tone: 'warning',
      title: 'Update Ready',
      description: 'Version 1.2.8 has been downloaded. Apply it when current extension work can be interrupted.',
    })

    expect(getChromeWebStoreUpdateStatusCopy({
      ok: true,
      status: 'throttled',
      currentVersion: '1.2.7',
      checkedAt: 1,
    })).toEqual({
      tone: 'warning',
      title: 'Check Throttled',
      description: 'Chrome limited repeated update checks. Try again later.',
    })
  })
})

describe('reloadExtensionForUpdate', () => {
  it('delegates update application to chrome.runtime.reload', () => {
    const runtime = makeRuntime()

    reloadExtensionForUpdate(runtime)

    expect(runtime.reload).toHaveBeenCalledTimes(1)
  })
})
