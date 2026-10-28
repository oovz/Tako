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
  title: string
  description: string
  confirmLabel: string
}

export function ClearHistoryDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
}: ClearHistoryDialogProps) {
  const [isClearing, setIsClearing] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)

  const handleConfirm = async () => {
    if (isClearing) return
    setIsClearing(true)
    setHasFailed(false)
    try {
      if (await onConfirm()) {
        onOpenChange(false)
      } else {
        setHasFailed(true)
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
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {hasFailed && (
          <p role="alert" className="text-sm text-destructive">
            {t("options_clearHistoryRetry")}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClearing}>
            {t("common_cancel")}
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
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
