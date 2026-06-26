import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { t } from '@/src/shared/i18n'

interface ClearHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<boolean>
}

export function ClearHistoryDialog({ open, onOpenChange, onConfirm }: ClearHistoryDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('options_clearHistoryTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('options_clearHistoryDesc')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('options_keepHistory')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void onConfirm().then((didClear) => {
                if (didClear) {
                  onOpenChange(false)
                }
              })
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('options_clearAll')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
