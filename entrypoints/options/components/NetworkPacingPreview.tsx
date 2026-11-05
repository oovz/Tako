import { t } from "@/src/runtime/i18n"

export function NetworkPacingPreview({
  imageDelay,
  concurrency,
  chapterDelay,
}: {
  imageDelay: number
  concurrency: number
  chapterDelay: number
}) {
  const starts = imageDelay > 0 ? [0, imageDelay, imageDelay * 2] : [0]

  return (
    <div className="m-4 min-w-0 rounded-lg border bg-background/70 p-4 @min-[38rem]:ml-0">
      <h3 className="text-sm font-semibold">{t("options_pacingPreview")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("options_pacingPreviewDesc")}
      </p>
      <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-2 text-xs tabular-nums">
        {starts.map((start) => (
          <li key={start} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-download-progress"
            />
            {start.toLocaleString()} ms
          </li>
        ))}
      </ol>
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt>{t("options_imageConcurrency")}</dt>
          <dd className="tabular-nums">{concurrency}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t("options_chapterDelay")}</dt>
          <dd className="tabular-nums">{chapterDelay.toLocaleString()} ms</dd>
        </div>
      </dl>
    </div>
  )
}
