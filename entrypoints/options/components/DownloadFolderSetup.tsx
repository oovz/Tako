import { ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { t } from "@/src/runtime/i18n"
import {
  clearFolderSetupFeedback,
  folderSetupMessage,
  readFolderSetupResult,
} from "../folder-setup-feedback"
import type { FolderSetupAction } from "./DownloadDestinationSection-contract"

const permissionChoiceSlot = "{chrome-permission-choice}"

export function DownloadFolderSetup({
  folderSetup,
  folderAccessRequired,
  busy,
}: {
  folderSetup: FolderSetupAction
  folderAccessRequired: boolean
  busy: boolean
}) {
  const [result, setResult] = useState(() =>
    readFolderSetupResult(
      typeof window === "undefined" ? "" : window.location.search
    )
  )

  useEffect(() => {
    if (result === null) return
    // A verification result applies to this visit and saved folder only.
    clearFolderSetupFeedback()
  }, [result])

  const [beforeChoice, afterChoice] = t("options_folderSetupInstructions", [
    permissionChoiceSlot,
  ]).split(permissionChoiceSlot)

  return (
    <div className="grid justify-items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
      <p className="font-semibold">{t("options_folderSetupTitle")}</p>
      <p className="text-muted-foreground">
        {beforeChoice}
        <strong className="options-folder-setup-choice inline-flex items-center gap-1 rounded border border-border bg-background px-1 font-medium text-foreground">
          <ShieldCheck aria-hidden="true" className="size-3 shrink-0" />
          {/* Chrome's prompt uses the browser locale even when Options overrides it. */}
          {globalThis.chrome?.i18n?.getMessage(
            "options_folderSetupAlwaysAllow"
          ) || t("options_folderSetupAlwaysAllow")}
        </strong>
        {afterChoice}
      </p>
      {result !== null && (
        <p className="text-destructive" role="alert">
          {t(folderSetupMessage(result))}
        </p>
      )}
      {folderAccessRequired && (
        <p className="text-muted-foreground">
          {t("options_folderSetupRestartTip")}
        </p>
      )}
      {folderSetup.disabled && (
        <p className="text-muted-foreground">
          {t("options_folderSetupSaveChanges")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto min-h-8 whitespace-normal text-left text-xs"
        disabled={folderSetup.disabled || busy}
        onClick={() => {
          setResult(null)
          void folderSetup.finish()
        }}
      >
        {t(
          folderAccessRequired
            ? "options_folderSetupRequestAccess"
            : "options_folderSetupFinish"
        )}
      </Button>
    </div>
  )
}
