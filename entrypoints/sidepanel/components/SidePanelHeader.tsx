import { Settings } from "lucide-react"

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
    <header className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-border bg-background z-30">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="inline-flex items-baseline gap-1.5 text-xs text-muted-foreground">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatSidePanelCount(activeCount)}
          </span>
          <span>{t("common_active")}</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 text-xs text-muted-foreground">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatSidePanelCount(queuedCount)}
          </span>
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
            <Settings aria-hidden="true" className="size-5" />
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
