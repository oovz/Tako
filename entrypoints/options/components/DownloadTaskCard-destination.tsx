import { TaskDestinationCaption } from "@/src/ui/shared/TaskDestinationCaption"
import { t } from "@/src/runtime/i18n"
import type { TaskCardModel } from "./DownloadTaskCard-model"

export function DownloadTaskCardDestination({
  model,
  useChromeFallback,
}: {
  model: TaskCardModel
  useChromeFallback?: true
}) {
  return (
    <>
      <TaskDestinationCaption
        useChromeFallback={useChromeFallback}
        destination={model.destination}
        requestedPath={model.requestedPath}
      />
      {model.targetUnavailable && (
        <p className="text-xs">{t("taskFolder_originalUnavailable")}</p>
      )}
      {model.failureMessage && (
        <p className="text-sm text-destructive">
          {t("common_error")}: {model.failureMessage}
        </p>
      )}
    </>
  )
}
