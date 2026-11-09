import { useId, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { t } from "@/src/runtime/i18n"
import {
  getTaskCardModel,
  type DownloadTaskCardProps,
} from "./DownloadTaskCard-model"
import { DownloadTaskCardHeading } from "./DownloadTaskCard-heading"
import { DownloadTaskCardChapters } from "./DownloadTaskCard-chapters"
import { DownloadTaskCardDestination } from "./DownloadTaskCard-destination"
import {
  DownloadTaskCardActionButtons,
  DownloadTaskCardCancelConfirmation,
  DownloadTaskCardGrantAccess,
  useDownloadTaskCardActions,
} from "./DownloadTaskCard-actions"

export type { DownloadTaskCardProps } from "./DownloadTaskCard-model"

export function DownloadTaskCard(props: DownloadTaskCardProps) {
  const {
    task,
    isChapterListExpanded: controlledExpanded,
    onChapterListExpandedChange,
  } = props
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false)
  const expanded = controlledExpanded ?? uncontrolledExpanded
  const chapterListId = useId()
  const model = getTaskCardModel(task)
  const actions = useDownloadTaskCardActions(props, model)
  const toggleChapters = () => {
    const nextExpanded = !expanded
    if (onChapterListExpandedChange) onChapterListExpandedChange(nextExpanded)
    else setUncontrolledExpanded(nextExpanded)
  }
  return (
    <Card
      className="options-task-card relative"
      aria-busy={actions.pendingAction !== null || actions.isCanceling}
    >
      <DownloadTaskCardCancelConfirmation task={task} actions={actions} />
      <DownloadTaskCardHeading task={task} />
      <CardContent className="flex flex-col gap-3">
        {model.saveUnconfirmed && (
          <p className="text-sm text-muted-foreground">
            {t("output_saveUnconfirmedDescription")}
          </p>
        )}
        <DownloadTaskCardChapters
          task={task}
          id={chapterListId}
          expanded={expanded}
          onToggle={toggleChapters}
        />
        <DownloadTaskCardDestination
          model={model}
          useChromeFallback={task.useChromeFallback}
        />
        <DownloadTaskCardGrantAccess model={model} actions={actions} />
        <DownloadTaskCardActionButtons
          task={task}
          model={model}
          actions={actions}
        />
      </CardContent>
    </Card>
  )
}
