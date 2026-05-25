import { Settings } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface SidePanelHeaderProps {
  activeCount: number
  queuedCount: number
  hasOptionsActionItems: boolean
  onOpenSettings: () => void | Promise<void>
}

export function SidePanelHeader({
  activeCount,
  queuedCount,
  hasOptionsActionItems,
  onOpenSettings,
}: SidePanelHeaderProps) {
  const settingsLabel = hasOptionsActionItems
    ? 'Open Options (Action item available)'
    : 'Open Options (Advanced Settings)'

  return (
    <header className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-border bg-background shadow-sm z-30">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5">
          <Badge
            variant={activeCount > 0 ? 'default' : 'secondary'}
            className="h-6 px-2.5 text-xs font-semibold"
          >
            <span className="tabular-nums">{activeCount}</span>&nbsp;active
          </Badge>
          <Badge variant="secondary" className="h-6 px-2.5 text-xs font-semibold">
            <span className="tabular-nums">{queuedCount}</span>&nbsp;queued
          </Badge>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
            onClick={onOpenSettings}
            aria-label={settingsLabel}
          >
            <Settings className="h-5 w-5" />
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
          {hasOptionsActionItems ? 'Settings need attention' : 'Settings'}
        </TooltipContent>
      </Tooltip>
    </header>
  )
}
