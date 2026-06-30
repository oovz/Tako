import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatBytes } from '@/entrypoints/options/components/downloads-tab-helpers'
import { t } from '@/src/runtime/i18n'

interface DownloadsHistoryActionsProps {
  historyStorageBytes: number
  showClearHistory: boolean
  onClearHistory: () => void
}

export function DownloadsHistoryActions({ historyStorageBytes, showClearHistory, onClearHistory }: DownloadsHistoryActionsProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t('options_historyStorageUsage', [formatBytes(historyStorageBytes)])}
      </p>
      <div className="flex justify-end gap-2">
        {showClearHistory && (
          <Button variant="outline" size="sm" onClick={onClearHistory}>
            <Trash2 data-icon="inline-start" className="size-4" />
            {t('options_clearAllHistory')}
          </Button>
        )}
      </div>
    </>
  )
}
