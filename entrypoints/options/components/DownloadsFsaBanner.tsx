import { Folder } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { FsaErrorState } from '@/entrypoints/options/hooks/useDownloadsTabState'
import { t } from '@/src/runtime/i18n'

interface DownloadsFsaBannerProps {
  fsaError: FsaErrorState
  isPickingFolder: boolean
  onPickFolder: () => Promise<void>
  onDismiss: () => Promise<void>
}

export function DownloadsFsaBanner({ fsaError, isPickingFolder, onPickFolder, onDismiss }: DownloadsFsaBannerProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-destructive">{t('sidepanel_fsaBannerTitle')}</p>
            <p className="text-xs text-muted-foreground">
              {fsaError.message || t('sidepanel_fsaBannerDefault')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onPickFolder} disabled={isPickingFolder}>
              <Folder data-icon="inline-start" className="size-3.5" />
              {t('sidepanel_reSelect')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void onDismiss()}>
              {t('common_dismiss')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
