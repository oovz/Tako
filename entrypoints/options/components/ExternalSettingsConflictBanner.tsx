import { CircleAlert, Loader2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { t } from "@/src/runtime/i18n"

interface ExternalSettingsConflictBannerProps {
  isResolving: boolean
  onReload: () => void | Promise<void>
  onKeepMine: () => void | Promise<void>
}

export function ExternalSettingsConflictBanner({
  isResolving,
  onReload,
  onKeepMine,
}: ExternalSettingsConflictBannerProps) {
  return (
    <Alert className="mb-6 border-amber-500/50 bg-amber-500/5">
      {isResolving ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <CircleAlert className="size-4" aria-hidden="true" />
      )}
      <AlertTitle>{t("options_externalChangesTitle")}</AlertTitle>
      <AlertDescription>
        <p>{t("options_externalChangesDescription")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isResolving}
            onClick={onReload}
          >
            {t("options_externalChangesReload")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isResolving}
            onClick={onKeepMine}
          >
            {t("options_externalChangesKeepMine")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
