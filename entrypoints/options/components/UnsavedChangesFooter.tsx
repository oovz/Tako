import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { t } from "@/src/runtime/i18n"

interface UnsavedChangesFooterProps {
  isSaving: boolean
  isSaveBlocked?: boolean
  onDiscard: () => void
  onSave: () => void | Promise<void>
}

export function UnsavedChangesFooter({
  isSaving,
  isSaveBlocked = false,
  onDiscard,
  onSave,
}: UnsavedChangesFooterProps) {
  return (
    <div className="fixed bottom-0 left-0 md:left-64 right-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200 shadow-lg">
      <div className="mx-auto max-w-5xl px-4 py-3 sm:px-8 sm:py-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
            <div className="size-2 rounded-full bg-destructive animate-pulse" />
            <span>{t("options_unsavedChanges")}</span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={onDiscard}
              variant="outline"
              disabled={isSaving}
              className="transition-all duration-150 active:scale-[0.97]"
            >
              {t("options_discard")}
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={isSaving || isSaveBlocked}
              className="shadow-sm transition-all duration-150 active:scale-[0.97]"
            >
              {isSaving && (
                <Loader2
                  data-icon="inline-start"
                  className="size-4 animate-spin"
                />
              )}
              {t("options_saveChanges")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
