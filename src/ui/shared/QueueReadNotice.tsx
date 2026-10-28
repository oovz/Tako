import { Button } from "@/components/ui/button"
import { t } from "@/src/runtime/i18n"
import type { StorageReadStatus } from "./hooks/useChromeStorageValue"

export function QueueReadNotice({
  status,
  onRetry,
}: {
  status: StorageReadStatus
  onRetry: () => void | Promise<void>
}) {
  if (status !== "error" && status !== "stale") return null
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p>{t(status === "stale" ? "queue_readStale" : "queue_readFailed")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void onRetry()}
      >
        {t("common_retry")}
      </Button>
    </div>
  )
}
