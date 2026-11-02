import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { t } from "@/src/runtime/i18n"

export function OptionsDiscardDialog({
  open,
  onOpenChange,
  discardChanges,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  discardChanges: () => Promise<boolean>
}) {
  const [isDiscarding, setIsDiscarding] = useState(false)
  const discard = async () => {
    if (isDiscarding) return
    setIsDiscarding(true)
    try {
      if (await discardChanges()) onOpenChange(false)
    } finally {
      setIsDiscarding(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isDiscarding) return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("options_discardUnsavedChanges")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("options_discardWarning")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDiscarding}>
            {t("common_cancel")}
          </AlertDialogCancel>
          <Button disabled={isDiscarding} onClick={() => void discard()}>
            {isDiscarding ? t("common_loading") : t("options_discardChanges")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
