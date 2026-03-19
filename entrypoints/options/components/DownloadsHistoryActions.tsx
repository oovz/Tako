import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatBytes } from '@/entrypoints/options/components/downloads-tab-helpers'

interface DownloadsHistoryActionsProps {
  historyStorageBytes: number
  showClearHistory: boolean
  onClearHistory: () => void
}

export function DownloadsHistoryActions({ historyStorageBytes, showClearHistory, onClearHistory }: DownloadsHistoryActionsProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Approximate history storage usage: {formatBytes(historyStorageBytes)}
      </p>
      <div className="flex justify-end gap-2">
        {showClearHistory && (
          <Button variant="outline" size="sm" onClick={onClearHistory}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear All History
          </Button>
        )}
      </div>
    </>
  )
}
