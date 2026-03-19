import { describe, expect, it } from 'vitest'

import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from '@/entrypoints/sidepanel/messages'
import { resolveSeriesCardMessage } from '@/entrypoints/sidepanel/components/SeriesContextCard'

describe('SeriesContextCard message mapping', () => {
  it('returns null when there is no blocking message', () => {
    expect(resolveSeriesCardMessage(undefined)).toBeNull()
  })

  it('maps unsupported tab message to no-series guidance', () => {
    expect(resolveSeriesCardMessage(TAB_NOT_SUPPORTED_MSG)).toEqual({
      title: 'No series detected',
      description: 'Open a supported manga series page to get started.',
    })
  })

  it('maps no-manga message to recognized-page error copy', () => {
    expect(resolveSeriesCardMessage(NO_MANGA_FOUND_MSG)).toEqual({
      title: 'This page is not recognized as a manga series',
      description: 'Open a supported manga series page to get started.',
    })
  })

  it('keeps unknown blocking messages as explicit error details', () => {
    expect(resolveSeriesCardMessage('Site integration timeout')).toEqual({
      title: 'This page is not recognized as a manga series',
      description: 'Site integration timeout',
    })
  })
})

