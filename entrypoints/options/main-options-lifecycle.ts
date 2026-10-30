import { useCallback, useEffect, useState } from "react"

import { applyUiLanguagePreference, t } from "@/src/runtime/i18n"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import { useUiPreferences } from "@/src/ui/shared/hooks/useUiPreferences"
import {
  applyMotionPreference,
  toDocumentLanguageTag,
} from "@/src/ui/shared/ui-preferences"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  getInitialOptionsSection,
  getOptionsSectionUrl,
  type OptionsSection,
} from "./tab-routing"

export function useOptionsNavigation() {
  const [activeSection, setActiveSection] = useState<OptionsSection>(() =>
    getInitialOptionsSection(window.location.search)
  )
  const handleSectionChange = useCallback(
    (section: OptionsSection) => {
      if (section === activeSection) return
      setActiveSection(section)
      window.history.pushState(
        null,
        "",
        getOptionsSectionUrl(window.location.href, section)
      )
    },
    [activeSection]
  )

  useEffect(() => {
    const handlePopState = () => {
      setActiveSection(getInitialOptionsSection(window.location.search))
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  return { activeSection, handleSectionChange }
}

interface SaveShortcutState {
  hasUnsavedChanges: boolean
  isSaving: boolean
  hasExternalChanges: boolean
  saveConfiguration: () => Promise<void>
}

export function useOptionsSaveShortcut({
  hasUnsavedChanges,
  isSaving,
  hasExternalChanges,
  saveConfiguration,
}: SaveShortcutState) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "s") return
      event.preventDefault()
      if (hasUnsavedChanges && !isSaving && !hasExternalChanges)
        void saveConfiguration()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hasUnsavedChanges, isSaving, hasExternalChanges, saveConfiguration])
}

export function useOptionsUnloadGuard(hasUnsavedChanges: boolean) {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = ""
      return ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedChanges])
}

export function useOptionsPageDocument(
  settingsBuffer: ExtensionSettings | null
) {
  useOptionsScrollLock()
  const { value: persistedUiPreferences, hydrated: uiPreferencesHydrated } =
    useUiPreferences()
  const { locale } = useI18n()

  useEffect(() => {
    if (!uiPreferencesHydrated) return
    void applyUiLanguagePreference(persistedUiPreferences.uiLanguage)
  }, [persistedUiPreferences.uiLanguage, uiPreferencesHydrated])

  useEffect(() => {
    if (!settingsBuffer && !uiPreferencesHydrated) return
    applyMotionPreference(
      settingsBuffer?.motionPreference ??
        persistedUiPreferences.motionPreference
    )
  }, [
    persistedUiPreferences.motionPreference,
    settingsBuffer,
    uiPreferencesHydrated,
  ])

  useEffect(() => {
    document.documentElement.lang = toDocumentLanguageTag(locale)
    document.title = t("options_takoSettings")
  }, [locale])
}

function useOptionsScrollLock() {
  useEffect(() => {
    const roots = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
    ]
    for (const root of roots) root?.classList.add("tako-scroll-locked")
    return () => {
      for (const root of roots) root?.classList.remove("tako-scroll-locked")
    }
  }, [])
}
