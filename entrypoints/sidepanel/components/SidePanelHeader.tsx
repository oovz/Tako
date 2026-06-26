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
        <Badge
          variant={activeCount > 0 ? 'default' : 'secondary'}
          className="h-6 px-2.5 text-xs font-semibold gap-1"
        >
          <span className="tabular-nums">{activeCount}</span>
          <span>active</span>
        </Badge>
        <Badge variant="secondary" className="h-6 px-2.5 text-xs font-semibold gap-1">
          <span className="tabular-nums">{queuedCount}</span>
          <span>queued</span>
        </Badge>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-9"
            onClick={onOpenSettings}
            aria-label={settingsLabel}
          >
            <Settings className="size-5" />
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
