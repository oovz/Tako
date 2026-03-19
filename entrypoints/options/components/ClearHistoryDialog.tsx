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
          <AlertDialogTitle>Clear all download history?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all download history. Downloaded files are not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>No, Keep History</AlertDialogCancel>
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
            Yes, Clear All
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
