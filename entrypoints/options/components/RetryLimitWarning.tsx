import { t } from "@/src/runtime/i18n"

export function RetryLimitWarning({
  id,
  provider,
  limit,
}: {
  id?: string
  provider: string
  limit: number
}) {
  return (
    <p
      id={id}
      role="status"
      className="text-xs text-amber-800 dark:text-amber-200"
    >
      {t("options_retryProviderWarning", [provider, String(limit)])}
    </p>
  )
}
