import { useId, useMemo, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/src/runtime/i18n"
import { LOG_LEVELS, type LogLevel } from "@/src/shared/download-contract"
import {
  getDiagnosticPreference,
  subscribeToDiagnosticPreference,
} from "@/src/runtime/diagnostic-preference"
import {
  clearDiagnostics,
  DIAGNOSTIC_CONTEXTS,
  type DiagnosticContext,
  type DiagnosticCursor,
  type DiagnosticEntry,
} from "@/src/runtime/diagnostic-store"
import { ClearHistoryDialog } from "../components/ClearHistoryDialog"
import { useDiagnosticPage } from "../hooks/useDiagnosticPage"

const levels = {
  debug: "options_logLevelDebug",
  info: "options_logLevelInfo",
  warn: "options_logLevelWarn",
  error: "options_logLevelError",
} as const
const contexts = {
  background: "diagnostics_background",
  offscreen: "diagnostics_offscreen",
  sidepanel: "diagnostics_sidepanel",
  options: "diagnostics_options",
} as const

interface Filters {
  level: LogLevel | ""
  context: DiagnosticContext | ""
  from: string
  to: string
  search: string
}

const emptyFilters: Filters = {
  level: "",
  context: "",
  from: "",
  to: "",
  search: "",
}
const fieldStyle =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"

function FilterFields({
  filters,
  disabled,
  onChange,
}: {
  filters: Filters
  disabled: boolean
  onChange: (filters: Filters) => void
}) {
  const id = useId()
  return (
    <fieldset
      disabled={disabled}
      className="grid gap-3 rounded-md border p-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <div className="space-y-1.5 sm:col-span-2 xl:col-span-4">
        <Label htmlFor={`${id}-search`}>{t("diagnostics_search")}</Label>
        <Input
          id={`${id}-search`}
          type="search"
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-level`}>{t("diagnostics_level")}</Label>
        <select
          id={`${id}-level`}
          className={fieldStyle}
          value={filters.level}
          onChange={(event) =>
            onChange({
              ...filters,
              level: event.target.value as Filters["level"],
            })
          }
        >
          <option value="">{t("diagnostics_allLevels")}</option>
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(levels[level])}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-source`}>{t("diagnostics_source")}</Label>
        <select
          id={`${id}-source`}
          className={fieldStyle}
          value={filters.context}
          onChange={(event) =>
            onChange({
              ...filters,
              context: event.target.value as Filters["context"],
            })
          }
        >
          <option value="">{t("diagnostics_allSources")}</option>
          {DIAGNOSTIC_CONTEXTS.map((context) => (
            <option key={context} value={context}>
              {t(contexts[context])}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-from`}>{t("diagnostics_from")}</Label>
        <Input
          id={`${id}-from`}
          type="datetime-local"
          value={filters.from}
          onChange={(event) =>
            onChange({ ...filters, from: event.target.value })
          }
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${id}-to`}>{t("diagnostics_to")}</Label>
        <Input
          id={`${id}-to`}
          type="datetime-local"
          value={filters.to}
          onChange={(event) => onChange({ ...filters, to: event.target.value })}
        />
      </div>
    </fieldset>
  )
}

function DiagnosticRow({ entry }: { entry: DiagnosticEntry }) {
  const date = new Date(entry.capturedAt)
  return (
    <li className="space-y-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>
        <span>{t(levels[entry.level])}</span>
        <span>{t(contexts[entry.context])}</span>
      </div>
      <p className="wrap-anywhere">{entry.message}</p>
      {entry.details !== undefined && (
        <details>
          <summary className="w-fit cursor-pointer text-xs text-muted-foreground">
            {t("diagnostics_details")}
          </summary>
          <pre className="mt-2 rounded-md bg-muted p-3 text-xs wrap-anywhere whitespace-pre-wrap">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
        </details>
      )}
    </li>
  )
}

export function DiagnosticsTab() {
  const level = useSyncExternalStore(
    subscribeToDiagnosticPreference,
    getDiagnosticPreference
  )
  const [filters, setFilters] = useState(emptyFilters)
  const [paused, setPaused] = useState(false)
  const [cursors, setCursors] = useState<DiagnosticCursor[]>([])
  const [clearOpen, setClearOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const query = useMemo(
    () => ({
      level: filters.level || undefined,
      context: filters.context || undefined,
      from: filters.from ? new Date(filters.from).getTime() : undefined,
      to: filters.to ? new Date(filters.to).setSeconds(59, 999) : undefined,
      search: filters.search,
    }),
    [filters]
  )
  const { page, failed } = useDiagnosticPage(
    query,
    cursors.at(-1),
    paused,
    refresh
  )
  const empty =
    filters.level ||
    filters.context ||
    filters.from ||
    filters.to ||
    filters.search.trim()
      ? "diagnostics_noMatch"
      : "diagnostics_empty"

  async function handleClear() {
    try {
      await clearDiagnostics()
      setPaused(false)
      setCursors([])
      setRefresh((value) => value + 1)
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 id="options-diagnostics-heading" className="text-xl font-semibold">
          {t("diagnostics_title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("diagnostics_description")}
        </p>
      </header>
      {level === null && (
        <p
          role="status"
          data-testid="diagnostic-verbosity-fallback"
          className="rounded-md border px-4 py-3 text-sm"
        >
          {t("diagnostics_fallback")}
        </p>
      )}
      <FilterFields
        filters={filters}
        disabled={paused}
        onChange={(next) => {
          setFilters(next)
          setCursors([])
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!page}
          onClick={() => setPaused(!paused)}
        >
          {t(paused ? "diagnostics_resume" : "diagnostics_pause")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setClearOpen(true)}
        >
          {t("diagnostics_clear")}
        </Button>
      </div>
      {failed && <p role="alert">{t("diagnostics_unavailable")}</p>}
      {!failed && !page && <p role="status">{t("diagnostics_loading")}</p>}
      {page?.entries.length === 0 && <p role="status">{t(empty)}</p>}
      {page && page.entries.length > 0 && (
        <ol className="divide-y rounded-md border">
          {page.entries.map((entry) => (
            <DiagnosticRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
      {(page?.next || cursors.length > 0) && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={paused || cursors.length === 0}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            {t("diagnostics_newer")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={paused || !page?.next}
            onClick={() => {
              if (page?.next) setCursors([...cursors, page.next])
            }}
          >
            {t("diagnostics_older")}
          </Button>
        </div>
      )}
      <ClearHistoryDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        onConfirm={handleClear}
        title={t("diagnostics_clear")}
        description={t("diagnostics_clearDescription")}
        confirmLabel={t("diagnostics_clear")}
        failureMessage={t("diagnostics_clearFailed")}
      />
    </div>
  )
}
