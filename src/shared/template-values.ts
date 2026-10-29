import type { TemplateMacroName } from "./template-macros"

export interface TemplateValuesContext {
  integrationName?: string
  publisher?: string
  seriesTitle?: string
  chapterTitle?: string
  chapterNumber?: number
  volumeTitle?: string
  volumeNumber?: number
  currentYear: number
  currentMonth: number
  currentDay: number
}

export function buildTemplateValues(
  context: TemplateValuesContext
): Record<TemplateMacroName, string | undefined> {
  const chapterNumber = context.chapterNumber?.toString()
  const volumeNumber = context.volumeNumber?.toString()
  return {
    YYYY: String(context.currentYear),
    MM: String(context.currentMonth).padStart(2, "0"),
    DD: String(context.currentDay).padStart(2, "0"),
    INTEGRATION_NAME: context.integrationName,
    PUBLISHER: context.publisher,
    SERIES_TITLE: context.seriesTitle,
    CHAPTER_TITLE: context.chapterTitle,
    VOLUME_TITLE: context.volumeTitle,
    CHAPTER_NUMBER: chapterNumber,
    CHAPTER_NUMBER_PAD2: chapterNumber?.padStart(2, "0"),
    CHAPTER_NUMBER_PAD3: chapterNumber?.padStart(3, "0"),
    VOLUME_NUMBER: volumeNumber,
    VOLUME_NUMBER_PAD2: volumeNumber?.padStart(2, "0"),
  }
}
