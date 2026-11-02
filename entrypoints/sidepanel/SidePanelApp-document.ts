import { useEffect } from "react"
import { t } from "@/src/runtime/i18n"
import { useUiPreferences } from "@/src/ui/shared/hooks/useUiPreferences"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import {
  applyUiPreferences,
  toDocumentLanguageTag,
} from "@/src/ui/shared/ui-preferences"

export function useSidePanelDocumentPreferences(): void {
  const { value, hydrated } = useUiPreferences()
  const { locale } = useI18n()
  useEffect(() => {
    if (hydrated) void applyUiPreferences(value)
  }, [value, hydrated])
  useEffect(() => {
    document.documentElement.lang = toDocumentLanguageTag(locale)
    document.title = t("extName")
  }, [locale])
}
