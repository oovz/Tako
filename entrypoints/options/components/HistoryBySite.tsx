import { getDisplayName } from "@/src/site-integrations/catalog"
import { t } from "@/src/runtime/i18n"
import type { SeriesHistory } from "../hooks/useOptionsHistory"
import { SettingsGroup } from "./primitives/SettingsGroup"

export function HistoryBySite({
  series,
}: {
  series: readonly SeriesHistory[]
}) {
  const counts = new Map<string, number>()
  for (const item of series) {
    counts.set(
      item.siteIntegrationId,
      (counts.get(item.siteIntegrationId) ?? 0) + item.chapterCount
    )
  }
  const sites = [...counts]
    .map(([id, chapters]) => ({ id, chapters, name: getDisplayName(id) ?? id }))
    .sort((a, b) => b.chapters - a.chapters || a.name.localeCompare(b.name))
  const largest = sites[0]?.chapters
  if (!largest) return null

  const title = t("options_historyBySite")
  return (
    <section aria-label={title}>
      <SettingsGroup title={title}>
        <ul className="divide-y divide-border/70">
          {sites.map(({ id, chapters, name }) => (
            <li key={id} className="space-y-2 px-4 py-3">
              <div className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 wrap-anywhere">{name}</span>
                <span className="shrink-0 tabular-nums">
                  {chapters.toLocaleString()}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="h-1 overflow-hidden rounded-full bg-border"
              >
                <div
                  className="h-full bg-download-progress"
                  style={{ width: `${(chapters / largest) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </section>
  )
}
