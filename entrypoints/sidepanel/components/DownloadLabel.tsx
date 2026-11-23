import { t } from "@/src/runtime/i18n"

export function DownloadLabel({ count }: { count: number }) {
  return (
    <span>
      {t("sidepanel_downloadAction")}
      {count > 0 && (
        <span aria-hidden="true" className="download-count">
          {" ("}
          {count.toLocaleString()}
          {")"}
        </span>
      )}
    </span>
  )
}
