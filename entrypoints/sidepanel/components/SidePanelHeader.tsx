import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { t } from "@/src/runtime/i18n"

interface SidePanelHeaderProps {
  activeCount: number | null
  queuedCount: number | null
  hasOptionsActionItems: boolean
  onOpenSettings: () => void | Promise<void>
}

export function formatSidePanelCount(count: number | null): string {
  if (count === null) return "—"
  return count > 99 ? "99+" : String(Math.max(0, count))
}

export function SidePanelHeader({
  activeCount,
  queuedCount,
  hasOptionsActionItems,
  onOpenSettings,
}: SidePanelHeaderProps) {
  const settingsLabel = hasOptionsActionItems
    ? t("sidepanel_openOptionsActionItem")
    : t("sidepanel_openOptionsAdvanced")

  return (
    <header className="panel-status">
      <div className="panel-counts">
        <span>
          <b>{formatSidePanelCount(activeCount)}</b>{" "}
          <span>{t("common_active")}</span>
        </span>
        <span>
          <b>{formatSidePanelCount(queuedCount)}</b>{" "}
          <span>{t("common_queued")}</span>
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-9 shrink-0"
            onClick={onOpenSettings}
            aria-label={settingsLabel}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
              <path strokeWidth="3" d="M8 6h.1m7 6h.1m-5 6h.1" />
            </svg>
            {hasOptionsActionItems && (
              <span
                aria-hidden="true"
                data-testid="options-action-indicator"
                className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive ring-2 ring-background"
              />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-sm">
          {hasOptionsActionItems
            ? t("sidepanel_settingsNeedAttention")
            : t("sidepanel_settingsTooltip")}
        </TooltipContent>
      </Tooltip>
    </header>
  )
}
