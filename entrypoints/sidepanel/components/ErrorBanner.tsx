import React from "react"
import { AlertCircle, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useErrors } from "../hooks/useErrors"
import { useInitFailure } from "../hooks/useInitFailure"
import { t } from "@/src/runtime/i18n"
import { getDownloadErrorMessage } from "@/src/runtime/download-error-presentation"
import { normalizeDownloadErrorCategory } from "@/src/shared/download-contract"

function getPersistentErrorMessage(code: string): string {
  return normalizeDownloadErrorCategory(code)
    ? getDownloadErrorMessage(code)
    : t("sidepanel_persistentError")
}

export function ErrorBanner() {
  const { errors, acknowledgeError } = useErrors()
  const { initFailed } = useInitFailure()
  const visibleErrors = errors.filter(
    (error) => error.code !== "FSA_HANDLE_INVALID"
  )

  if (!initFailed && visibleErrors.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-4 bg-background/95 backdrop-blur border-b">
      {initFailed && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>{t("common_error")}</AlertTitle>
          <AlertDescription>{t("sidepanel_initFailed")}</AlertDescription>
        </Alert>
      )}
      {visibleErrors.map((error) => (
        <Alert
          key={error.code}
          variant={error.severity === "error" ? "destructive" : "default"}
        >
          <AlertCircle className="size-4" />
          <AlertTitle>
            {error.severity === "error"
              ? t("common_error")
              : t("common_warning")}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">
              {getPersistentErrorMessage(error.code)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => acknowledgeError(error.code)}
            >
              <X className="size-4" />
              <span className="sr-only">{t("common_dismiss")}</span>
            </Button>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}
