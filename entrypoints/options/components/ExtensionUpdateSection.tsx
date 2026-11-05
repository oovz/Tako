import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  RotateCw,
  TriangleAlert,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SettingsGroup } from "./primitives/SettingsGroup"
import { getChromeWebStoreUpdateStatusCopy } from "@/src/runtime/extension-update-check"
import { useExtensionUpdateState } from "./ExtensionUpdateSection-state"
import { cn } from "@/src/shared/utils"
import { t } from "@/src/runtime/i18n"

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb"

function statusClasses(
  tone: ReturnType<typeof getChromeWebStoreUpdateStatusCopy>["tone"]
): string {
  if (tone === "success")
    return "border-primary/30 bg-primary/5 text-foreground"
  if (tone === "warning")
    return "border-primary/30 bg-primary/5 text-foreground"
  if (tone === "error")
    return "border-destructive/40 bg-destructive/10 text-foreground"
  return "border-border bg-muted/40 text-foreground"
}

function StatusIcon({
  tone,
}: {
  tone: ReturnType<typeof getChromeWebStoreUpdateStatusCopy>["tone"]
}) {
  if (tone === "success") {
    return <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
  }

  return (
    <TriangleAlert
      aria-hidden="true"
      className={cn(
        "size-4",
        tone === "error" ? "text-destructive" : "text-primary"
      )}
    />
  )
}

export function ExtensionUpdateSection() {
  const {
    currentVersion,
    lastResult,
    isChecking,
    handleCheckForUpdates,
    handleApplyUpdate,
  } = useExtensionUpdateState()
  const statusCopy = lastResult
    ? getChromeWebStoreUpdateStatusCopy(lastResult)
    : null

  const canApplyUpdate =
    lastResult?.ok === true && lastResult.status === "update_available"

  return (
    <SettingsGroup
      title={t("options_chromeWebStoreUpdates")}
      description={t("options_autoUpdateNote")}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" translate="no">
            {t("options_installedVersion", [currentVersion])}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={isChecking}
            >
              <RotateCw
                aria-hidden="true"
                className={cn(isChecking && "animate-spin")}
              />
              {isChecking
                ? t("options_checking")
                : t("options_checkForUpdates")}
            </Button>
            {canApplyUpdate && (
              <Button type="button" onClick={handleApplyUpdate}>
                <RefreshCw aria-hidden="true" />
                {t("options_applyUpdate")}
              </Button>
            )}
            <Button asChild variant="ghost">
              <a href={CHROME_WEB_STORE_URL} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                {t("options_openStoreListing")}
              </a>
            </Button>
          </div>
        </div>

        {statusCopy && (
          <Alert className={statusClasses(statusCopy.tone)} aria-live="polite">
            <StatusIcon tone={statusCopy.tone} />
            <AlertTitle>{statusCopy.title}</AlertTitle>
            <AlertDescription>{statusCopy.description}</AlertDescription>
          </Alert>
        )}
      </div>
    </SettingsGroup>
  )
}
