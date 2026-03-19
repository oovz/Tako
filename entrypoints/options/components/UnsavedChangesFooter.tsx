import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface UnsavedChangesFooterProps {
  isSaving: boolean
  onDiscard: () => void
  onSave: () => void | Promise<void>
}

export function UnsavedChangesFooter({ isSaving, onDiscard, onSave }: UnsavedChangesFooterProps) {
  return (
    <div className="fixed bottom-0 left-0 md:left-64 right-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
      <div className="max-w-4xl px-8 py-4 mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
            You have unsaved changes
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onDiscard}
              variant="outline"
              disabled={isSaving}
              className="transition-colors"
            >
              Discard
            </Button>
            <Button
              onClick={onSave}
              disabled={isSaving}
              className="shadow-sm transition-all"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
