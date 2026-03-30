import { describe, expect, it } from 'vitest'

import { settingsExportSchema } from '@/entrypoints/options/validation'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'

describe('options validation', () => {
  it('accepts canonical settings exports including includeCoverImage', () => {
    const parsed = settingsExportSchema.safeParse({
      settings: DEFAULT_SETTINGS,
      overrides: {
        mangadex: {
          outputFormat: 'cbz',
        },
      },
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      throw new Error('Expected canonical settings export to validate')
    }

    expect(parsed.data.settings.downloads.includeCoverImage).toBe(DEFAULT_SETTINGS.downloads.includeCoverImage)
  })

  it('strips stale override fields from imported data', () => {
    const parsed = settingsExportSchema.safeParse({
      settings: DEFAULT_SETTINGS,
      overrides: {
        mangadex: {
          outputFormat: 'cbz',
          autoInjectUI: true,
        },
      },
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      throw new Error('Expected import export schema to tolerate stale override fields')
    }

    expect(parsed.data.overrides?.mangadex).toEqual({
      outputFormat: 'cbz',
    })
  })
})
