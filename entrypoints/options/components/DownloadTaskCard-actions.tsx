import { useState } from "react"
import { RotateCcw, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"
import { OptionsFsaController } from "../controllers/options-fsa-controller"
import { getDownloadCancelPresentation } from "@/src/runtime/download-error-presentation"
import { t } from "@/src/runtime/i18n"
import type { DownloadTaskCardProps } from "./DownloadTaskCard-model"
import type { TaskCardAction, TaskCardModel } from "./DownloadTaskCard-model"

async function grantTaskFolderAccess(model: TaskCardModel): Promise<void> {
  if (model.destination.kind !== "file-system-access") return
  try {
    const access = await new OptionsFsaController().grantSavedAccess(
      model.destination.handleId
    )
    if (access.status === "granted")
      toast.success(t("taskFolder_accessGranted"))
    else
      toast.error(
        t(
          access.status === "missing"
            ? "settings_customFolderNotFound"
            : "options_toastPermissionDenied"
        )
      )
  } catch (error) {
    toast.error(t("taskFolder_accessFailed"), {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

export function useDownloadTaskCardActions(
  { task, onCancel, onRetry, onRestart, onRemove }: DownloadTaskCardProps,
  model: TaskCardModel
) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<TaskCardAction | null>(
    null
  )

  const cancelTask = async () => {
    if (isCanceling) return
    setIsCanceling(true)
    setCancelError(null)
    try {
      const result = await onCancel(task.id)
      if (result.success) setConfirmingCancel(false)
      else setCancelError(t("options_toastCancelFailed"))
    } catch {
      setCancelError(t("options_toastCancelFailed"))
    } finally {
      setIsCanceling(false)
    }
  }

  const requestCancel = () => {
    setCancelError(null)
    if (task.status === "downloading") setConfirmingCancel(true)
    else void cancelTask()
  }
  const dismissCancel = () => {
    setCancelError(null)
    setConfirmingCancel(false)
  }
  const callbacks = {
    retry: () => onRetry(task.id),
    restart: () => onRestart(task.id),
    remove: () => onRemove(task.id),
    grant: () => grantTaskFolderAccess(model),
  }
  const runTaskAction = async (action: TaskCardAction) => {
    if (pendingAction) return
    setPendingAction(action)
    try {
      await callbacks[action]()
    } finally {
      setPendingAction(null)
    }
  }
  return {
    confirmingCancel,
    isCanceling,
    cancelError,
    pendingAction,
    cancelTask,
    requestCancel,
    dismissCancel,
    runTaskAction,
  }
}

export type TaskCardActionsState = ReturnType<typeof useDownloadTaskCardActions>

export function DownloadTaskCardCancelConfirmation({
  task,
  actions,
}: {
  task: DownloadTaskCardProps["task"]
  actions: TaskCardActionsState
}) {
  if (!actions.confirmingCancel || task.status !== "downloading") return null
  const presentation = getDownloadCancelPresentation()
  return (
    <InlineConfirmation
      {...presentation}
      pendingLabel={t("sidepanel_cancelingDownload")}
      cancelLabel={t("common_no")}
      isPending={actions.isCanceling}
      errorMessage={actions.cancelError}
      onConfirm={() => void actions.cancelTask()}
      onCancel={actions.dismissCancel}
    />
  )
}

export function DownloadTaskCardGrantAccess({
  model,
  actions,
}: {
  model: TaskCardModel
  actions: TaskCardActionsState
}) {
  if (!model.permissionFailure) return null
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={actions.pendingAction !== null}
      onClick={() => void actions.runTaskAction("grant")}
    >
      {t("folderAccess_grant")}
    </Button>
  )
}

export function DownloadTaskCardActionButtons({
  task,
  model,
  actions,
}: {
  task: DownloadTaskCardProps["task"]
  model: TaskCardModel
  actions: TaskCardActionsState
}) {
  const canCancel = task.status === "downloading" || task.status === "queued"
  const queuedCancellation = task.status === "queued" && actions.isCanceling
  return (
    <>
      <div className="flex flex-wrap gap-2 pt-2">
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            disabled={queuedCancellation}
            onClick={actions.requestCancel}
          >
            <XCircle data-icon="inline-start" className="size-4" />
            {queuedCancellation
              ? t("sidepanel_cancelingDownload")
              : t("common_cancel")}
          </Button>
        )}
        {model.recoveryActions.map(({ action, label }) => {
          const Icon = action === "remove" ? Trash2 : RotateCcw
          return (
            <Button
              key={action}
              variant="outline"
              size="sm"
              disabled={actions.pendingAction !== null}
              onClick={() => void actions.runTaskAction(action)}
            >
              <Icon data-icon="inline-start" className="size-4" />
              {label}
            </Button>
          )
        })}
      </div>
      {task.status === "queued" && actions.cancelError && (
        <p className="text-sm text-destructive">{actions.cancelError}</p>
      )}
    </>
  )
}
