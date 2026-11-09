import { t } from "@/src/runtime/i18n"

const MACRO_LABELS = {
  "<SERIES_TITLE>": "options_macroSeries",
  "<CHAPTER_TITLE>": "options_macroChapterTitle",
  "<CHAPTER_NUMBER>": "options_macroChapterNumber",
  "<VOLUME_NUMBER>": "options_macroVolumeNumber",
  "<CHAPTER_NUMBER_PAD2>": "options_macroChapterTwoDigits",
  "<CHAPTER_NUMBER_PAD3>": "options_macroChapterThreeDigits",
} as const
const PATH_MACROS = [
  "<SERIES_TITLE>",
  "<CHAPTER_NUMBER>",
  "<CHAPTER_TITLE>",
  "<VOLUME_NUMBER>",
] as const
const FILENAME_MACROS = [
  "<CHAPTER_TITLE>",
  "<CHAPTER_NUMBER>",
  "<CHAPTER_NUMBER_PAD2>",
  "<CHAPTER_NUMBER_PAD3>",
  "<SERIES_TITLE>",
  "<VOLUME_NUMBER>",
] as const

export function TemplateMacros({
  kind,
  value,
  onChange,
}: {
  kind: "path" | "filename"
  value: string
  onChange: (value: string) => void
}) {
  const macros = kind === "path" ? PATH_MACROS : FILENAME_MACROS
  const append = (macro: string) => {
    const separator = kind === "path" ? (value.endsWith("/") ? "" : "/") : " - "
    onChange(value ? value + separator + macro : macro)
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {macros.map((macro) => (
        <button
          key={macro}
          title={macro}
          type="button"
          onClick={() => append(macro)}
          className="options-macro inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors duration-150 cursor-pointer"
        >
          + {t(MACRO_LABELS[macro])}
        </button>
      ))}
    </div>
  )
}
