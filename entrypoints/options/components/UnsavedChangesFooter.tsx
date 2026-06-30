import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { t } from '@/src/runtime/i18n'

interface UnsavedChangesFooterProps {
  isSaving: boolean
  onDiscard: () => void
  onSave: () => void | Promise<void>
}

export function UnsavedChangesFooter({ isSaving, onDiscard, onSave }: UnsavedChangesFooterProps) {
  return (
    <div className="fixed bottom-0 left-0 md:left-64 right-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
      <div className="max-w-3xl px-8 py-4 mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-2 rounded-full bg-destructive animate-pulse" />
            {t('options_unsavedChanges')}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onDiscard}
              variant="outline"
              disabled={isSaving}
              className="transition-colors"
            >
              {t('options_discard')}
            </Button>
            <Button
              onClick={onSave}
              disabled={isSaving}
              className="shadow-sm transition-all"
            >
              {isSaving && <Loader2 data-icon="inline-start" className="size-4 animate-spin" />}
              {t('options_saveChanges')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
