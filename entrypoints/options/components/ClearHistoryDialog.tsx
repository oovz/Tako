import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { t } from "@/src/runtime/i18n"

interface ClearHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<boolean>
}

export function ClearHistoryDialog({
  open,
  onOpenChange,
  onConfirm,
}: ClearHistoryDialogProps) {
  const [isClearing, setIsClearing] = useState(false)

  const handleConfirm = async () => {
    if (isClearing) return
    setIsClearing(true)
    try {
      if (await onConfirm()) {
        onOpenChange(false)
      }
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isClearing) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("options_clearHistoryTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("options_clearHistoryDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClearing}>
            {t("options_keepHistory")}
          </AlertDialogCancel>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isClearing}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isClearing && (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            )}
            {t("options_clearAll")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
