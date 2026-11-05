import { Loader2 } from "lucide-react"
import type { Ref } from "react"

import { Button } from "@/components/ui/button"
import { t } from "@/src/runtime/i18n"

interface UnsavedChangesFooterProps {
  discardButtonRef: Ref<HTMLButtonElement>
  isSaving: boolean
  isSaveBlocked?: boolean
  onDiscard: () => void
  onSave: () => void | Promise<void>
}

export function UnsavedChangesFooter({
  discardButtonRef,
  isSaving,
  isSaveBlocked = false,
  onDiscard,
  onSave,
}: UnsavedChangesFooterProps) {
  return (
    <div className="shrink-0 border-t bg-background">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-muted-foreground"
            />
            <span>{t("options_unsavedChanges")}</span>
          </div>
          <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
            <Button
              type="button"
              ref={discardButtonRef}
              onClick={onDiscard}
              variant="outline"
              disabled={isSaving}
              className="h-auto min-h-9 whitespace-normal"
            >
              {t("options_discard")}
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={isSaving || isSaveBlocked}
              className="h-auto min-h-9 whitespace-normal"
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
