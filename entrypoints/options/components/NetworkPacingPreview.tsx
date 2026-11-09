import { useState, type CSSProperties } from "react"
import { BookOpen, Image, ArrowRight, RotateCcw, Timer } from "lucide-react"
import {
  useOptionsPreview,
  useOptionsMotionEnabled,
} from "../hooks/useOptionsMotion"
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
  const [replay, setReplay] = useState(0)
  const motionEnabled = useOptionsMotionEnabled()
  const values = [imageDelay, concurrency, chapterDelay].join(":")
  const preview = useOptionsPreview(values)
  const timeScale = Math.min(1, 1000 / Math.max(1, imageDelay, chapterDelay))
  const beat = imageDelay * timeScale
  const starts = imageDelay > 0 ? [0, imageDelay, imageDelay * 2] : [0]
  return (
    <div
      ref={preview}
      className="options-pacing-preview"
      role="group"
      aria-label={t("options_pacingPreview")}
    >
      <div className="options-pacing-heading">
        <h3>{t("options_pacingPreview")}</h3>
        <button
          type="button"
          className="options-replay"
          aria-label={t("options_replayExample")}
          title={t("options_replayExample")}
          aria-disabled={!motionEnabled}
          onClick={() => {
            if (motionEnabled) setReplay((value) => value + 1)
          }}
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("options_pacingPreviewDesc")}
      </p>
      <div key={values + ":" + replay} className="options-flow">
        <div className="options-flow-chapter">
          <BookOpen aria-hidden="true" />
          <span>{t("options_currentChapter")}</span>
        </div>
        <div className="options-flow-connector" aria-hidden="true">
          <span className="options-flow-pulse" />
        </div>
        <div className="options-flow-capacity">
          <p>
            {t(
              concurrency === 1
                ? "options_oneImageAtATime"
                : "options_parallelImages",
              [String(concurrency)]
            )}
          </p>
          <div
            className="options-image-slots"
            aria-hidden="true"
            style={{ "--slots": Math.min(concurrency, 5) } as CSSProperties}
          >
            {Array.from({ length: concurrency }, (_, index) => (
              <span
                key={index}
                className="options-image-slot"
                style={
                  { "--slot-delay": `${180 + index * 65}ms` } as CSSProperties
                }
              >
                <Image />
              </span>
            ))}
          </div>
        </div>
        <ol
          className="options-request-sequence"
          aria-label={t("options_exampleRequestStarts")}
        >
          {starts.map((start, index) => (
            <li key={index} className="options-request-step">
              <span
                aria-hidden="true"
                className="options-request-dot"
                style={
                  {
                    "--start-delay": `${200 + index * beat}ms`,
                  } as CSSProperties
                }
              />
              {start.toLocaleString()} ms
            </li>
          ))}
        </ol>
        <div
          className="options-chapter-gap"
          style={
            {
              "--chapter-start": `${700 + 2 * beat}ms`,
              "--chapter-duration": `${Math.max(165, chapterDelay * timeScale)}ms`,
            } as CSSProperties
          }
        >
          <span>
            <Timer aria-hidden="true" />
            <strong>{chapterDelay.toLocaleString()} ms</strong>
          </span>
          <span className="options-chapter-gap-label">
            {t("options_afterChapter")}
          </span>
          <ArrowRight aria-hidden="true" className="options-next-arrow" />
          <span className="options-next-chapter">
            <BookOpen aria-hidden="true" />
            {t("options_nextChapter")}
          </span>
        </div>
      </div>
    </div>
  )
}
