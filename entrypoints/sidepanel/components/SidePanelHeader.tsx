import { Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { t } from "@/src/runtime/i18n"
import type { OptionsActionItemSeverity } from "@/src/runtime/options-action-items"
import { cn } from "@/src/shared/utils"

interface SidePanelHeaderProps {
  activeCount: number | null
  queuedCount: number | null
  optionsActionSeverity: OptionsActionItemSeverity | null
  onOpenSettings: () => void | Promise<void>
}

export function formatSidePanelCount(count: number | null): string {
  if (count === null) return "—"
  return count > 99 ? "99+" : String(Math.max(0, count))
}

export function SidePanelHeader({
  activeCount,
  queuedCount,
  optionsActionSeverity,
  onOpenSettings,
}: SidePanelHeaderProps) {
  const settingsLabel = optionsActionSeverity
    ? t("sidepanel_openOptionsActionItem")
    : t("sidepanel_openOptionsAdvanced")

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="relative size-9 shrink-0"
      onClick={onOpenSettings}
      aria-label={settingsLabel}
    >
      <Settings aria-hidden="true" />
      {optionsActionSeverity && (
        <span
          aria-hidden="true"
          data-testid="options-action-indicator"
          data-severity={optionsActionSeverity}
          className={cn(
            "absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-background",
            optionsActionSeverity === "error"
              ? "bg-destructive"
              : "bg-amber-500"
          )}
        />
      )}
    </Button>
  )

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
        <TooltipTrigger asChild>{settingsButton}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-sm">
          {t(
            optionsActionSeverity
              ? "sidepanel_settingsNeedAttention"
              : "sidepanel_settingsTooltip"
          )}
        </TooltipContent>
      </Tooltip>
      <span role="status" className="sr-only">
        {optionsActionSeverity ? t("sidepanel_settingsNeedAttention") : ""}
      </span>
    </header>
  )
}
