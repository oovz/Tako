import { describe, expect, it } from 'vitest'

import config from '@/wxt.config'

describe('wxt manifest contract', () => {
  it('keeps the product Chrome floor at 122+', () => {
    const manifest =
      config.manifest && typeof config.manifest === 'object' && !('then' in config.manifest)
        ? config.manifest
        : undefined

    expect(manifest?.minimum_chrome_version).toBe('122')
  })
})
