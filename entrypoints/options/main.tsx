/**
 * Tako Manga Downloader - Options Page
 * Refactored with sidebar navigation following shadcn/ui patterns
 */

import { createRoot } from "react-dom/client"
import "@/globals.css"
import {
  useState,
  lazy,
  Suspense,
  Profiler,
  useEffect,
  useCallback,
} from "react"
import { Toaster } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import logger from "@/src/runtime/logger"
import { applyUiLanguagePreference, t } from "@/src/runtime/i18n"
import { ErrorBoundary } from "@/src/ui/shared/components/ErrorBoundary"
import { useI18n } from "@/src/ui/shared/hooks/useI18n"
import { useUiPreferences } from "@/src/ui/shared/hooks/useUiPreferences"
import {
  applyMotionPreference,
  toDocumentLanguageTag,
} from "@/src/ui/shared/ui-preferences"
import {
  getInitialOptionsSection,
  getOptionsSectionUrl,
  type OptionsSection,
} from "./tab-routing"
import { useOptionsPageState } from "./hooks/useOptionsPageState"

// Lazy load all tabs for code splitting
const GlobalSettingsTab = lazy(() =>
  import("./tabs/GlobalSettingsTab").then((m) => ({
    default: m.GlobalSettingsTab,
  }))
)
const SiteIntegrationManagementTab = lazy(() =>
  import("./tabs/SiteIntegrationManagementTab").then((m) => ({
    default: m.SiteIntegrationManagementTab,
  }))
)
const HistoryTab = lazy(() =>
  import("./tabs/HistoryTab").then((m) => ({ default: m.HistoryTab }))
)
const DownloadsTab = lazy(() =>
  import("./tabs/DownloadsTab").then((m) => ({ default: m.DownloadsTab }))
)

// Debug settings component (imported directly since it's small)
import { DebugSettingsSection } from "./components/DebugSettingsSection"
import { ExtensionUpdateSection } from "./components/ExtensionUpdateSection"
import { ExternalSettingsConflictBanner } from "./components/ExternalSettingsConflictBanner"
import { OptionsSidebar } from "./components/OptionsSidebar"
import { SectionLoadingSkeleton } from "./components/SectionLoadingSkeleton"
import { UnsavedChangesFooter } from "./components/UnsavedChangesFooter"

// Performance monitoring callback (development only)
function onRenderCallback(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number
) {
  if (import.meta.env.DEV) {
    logger.debug(`⚡ [Profiler] ${id} - ${phase}`, {
      actualDuration: `${actualDuration.toFixed(2)}ms`,
      baseDuration: `${baseDuration.toFixed(2)}ms`,
      improvement:
        baseDuration > 0
          ? `${((1 - actualDuration / baseDuration) * 100).toFixed(1)}%`
          : "N/A",
    })
  }
}

function OptionsPage() {
  const {
    settings,
    settingsBuffer,
    overrides,
    siteIntegrationEnablement,
    siteIntegrationSettingsByIntegration,
    historyStats,
    historySeries,
    selectedFolderName,
    isLoading,
    loadFailed,
    isSaving,
    isClearing,
    isPickingFolder,
    hasUnsavedChanges,
    hasExternalChanges,
    isResolvingExternalChanges,
    handleSettingsChange,
    handleSiteIntegrationSettingsChange,
    handleOverrideChange,
    handleSiteIntegrationEnablementChange,
    pickDownloadFolder,
    repairDownloadFolder,
    grantDownloadFolderAccess,
    saveConfiguration,
    clearAllHistory,
    clearSeriesHistory,
    handleRefreshHistory,
    discardChanges,
    resolveExternalChanges,
    retryLoad,
  } = useOptionsPageState()
  const { value: persistedUiPreferences, hydrated: uiPreferencesHydrated } =
    useUiPreferences()
  const { locale } = useI18n()
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [pendingSectionChange, setPendingSectionChange] =
    useState<OptionsSection | null>(null)
  const [activeSection, setActiveSection] = useState<OptionsSection>(() =>
    getInitialOptionsSection(window.location.search)
  )

  const commitSectionChange = useCallback(
    (section: OptionsSection, mode: "push" | "replace" = "push") => {
      setActiveSection(section)
      const url = getOptionsSectionUrl(window.location.href, section)
      window.history[mode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        url
      )
    },
    []
  )

  const handleSectionChange = useCallback(
    (section: OptionsSection) => {
      if (section === activeSection) return
      if (hasUnsavedChanges) {
        setPendingSectionChange(section)
        setShowDiscardDialog(true)
      } else {
        commitSectionChange(section)
      }
    },
    [activeSection, commitSectionChange, hasUnsavedChanges]
  )

  useEffect(() => {
    const handlePopState = () => {
      const section = getInitialOptionsSection(window.location.search)
      if (section === activeSection) return
      if (hasUnsavedChanges) {
        window.history.replaceState(
          null,
          "",
          getOptionsSectionUrl(window.location.href, activeSection)
        )
        setPendingSectionChange(section)
        setShowDiscardDialog(true)
        return
      }
      setActiveSection(section)
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [activeSection, hasUnsavedChanges])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ""
        return ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedChanges])

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

  useEffect(() => {
    const root = document.getElementById("root")
    document.documentElement.classList.add("tako-scroll-locked")
    document.body.classList.add("tako-scroll-locked")
    if (root) {
      root.classList.add("tako-scroll-locked")
    }

    return () => {
      document.documentElement.classList.remove("tako-scroll-locked")
      document.body.classList.remove("tako-scroll-locked")
      if (root) {
        root.classList.remove("tako-scroll-locked")
      }
    }
  }, [])

  if (loadFailed && (!settings || !settingsBuffer)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p role="alert" className="text-sm text-destructive">
            {t("options_toastLoadFailed")}
          </p>
          <Button type="button" variant="outline" onClick={retryLoad}>
            {t("common_restart")}
          </Button>
        </div>
      </div>
    )
  }

  if (isLoading || !settings || !settingsBuffer) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div
          className="text-center flex flex-col gap-4"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">
            {t("options_loadingSettings")}
          </p>
        </div>
      </div>
    )
  }

  const pageContent = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground font-sans antialiased md:flex-row">
      <Toaster />

      <OptionsSidebar
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />

      {/* Main Content - following shadcn/ui dashboard patterns */}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col p-4 pb-24 sm:p-6 sm:pb-24 md:p-8 md:pb-24">
          {hasExternalChanges && (
            <ExternalSettingsConflictBanner
              isResolving={isResolvingExternalChanges}
              onReload={async () => {
                await resolveExternalChanges("reload")
              }}
              onKeepMine={async () => {
                await resolveExternalChanges("keep-mine")
              }}
            />
          )}

          {activeSection === "global" && (
            <section
              aria-labelledby="options-global-heading"
              className="animate-in fade-in slide-in-from-right-4 duration-300"
            >
              <Suspense fallback={<SectionLoadingSkeleton />}>
                <GlobalSettingsTab
                  settings={settingsBuffer}
                  onChange={handleSettingsChange}
                />
              </Suspense>
            </section>
          )}

          {activeSection === "integrations" && (
            <section
              aria-labelledby="options-integrations-heading"
              className="animate-in fade-in slide-in-from-right-4 duration-300"
            >
              <Suspense fallback={<SectionLoadingSkeleton />}>
                <SiteIntegrationManagementTab
                  overrides={overrides}
                  siteIntegrationEnablement={siteIntegrationEnablement}
                  globalSettings={settingsBuffer}
                  siteIntegrationSettingsByIntegration={
                    siteIntegrationSettingsByIntegration
                  }
                  onSiteIntegrationSettingsChange={
                    handleSiteIntegrationSettingsChange
                  }
                  onSiteIntegrationEnablementChange={
                    handleSiteIntegrationEnablementChange
                  }
                  onChange={handleOverrideChange}
                />
              </Suspense>
            </section>
          )}

          {activeSection === "downloads" && (
            <section
              aria-labelledby="options-downloads-heading"
              className="animate-in fade-in slide-in-from-right-4 duration-300"
            >
              <Suspense fallback={<SectionLoadingSkeleton />}>
                <DownloadsTab
                  settings={settingsBuffer}
                  onChange={handleSettingsChange}
                  selectedFolderName={selectedFolderName}
                  onPickFolder={pickDownloadFolder}
                  onRepairFolder={repairDownloadFolder}
                  onGrantFolderAccess={grantDownloadFolderAccess}
                  isPickingFolder={isPickingFolder}
                  isSaving={isSaving}
                />
              </Suspense>
            </section>
          )}

          {activeSection === "debug" && (
            <section
              aria-labelledby="options-debug-heading"
              className="animate-in fade-in slide-in-from-right-4 duration-300"
            >
              <div className="flex flex-col gap-6">
                {/* Debug Settings Section */}
                <DebugSettingsSection
                  settings={settingsBuffer}
                  onChange={handleSettingsChange}
                />

                <ExtensionUpdateSection />

                {/* History Tab Content */}
                <Suspense fallback={<SectionLoadingSkeleton />}>
                  <HistoryTab
                    stats={historyStats}
                    series={historySeries}
                    onClearAll={clearAllHistory}
                    onClearSeries={clearSeriesHistory}
                    onRefreshSeries={handleRefreshHistory}
                    isClearing={isClearing}
                  />
                </Suspense>
              </div>
            </section>
          )}
        </div>
      </main>

      {hasUnsavedChanges && (
        <UnsavedChangesFooter
          isSaving={isSaving}
          isSaveBlocked={hasExternalChanges || isResolvingExternalChanges}
          onDiscard={() => setShowDiscardDialog(true)}
          onSave={saveConfiguration}
        />
      )}

      {/* Discard confirmation dialog */}
      <AlertDialog
        open={showDiscardDialog}
        onOpenChange={(open) => {
          if (!open && isDiscarding) return
          setShowDiscardDialog(open)
          if (!open) {
            setPendingSectionChange(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("options_discardUnsavedChanges")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("options_discardWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDiscarding}>
              {t("common_cancel")}
            </AlertDialogCancel>
            <Button
              disabled={isDiscarding}
              onClick={() => {
                if (isDiscarding) return
                setIsDiscarding(true)
                void (async () => {
                  const discarded = await discardChanges()
                  if (!discarded) return
                  setShowDiscardDialog(false)
                  if (pendingSectionChange) {
                    commitSectionChange(pendingSectionChange, "replace")
                    setPendingSectionChange(null)
                  }
                })().finally(() => setIsDiscarding(false))
              }}
            >
              {isDiscarding ? t("common_loading") : t("options_discardChanges")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  if (import.meta.env.DEV) {
    return (
      <Profiler id="OptionsPage" onRender={onRenderCallback}>
        {pageContent}
      </Profiler>
    )
  }

  return pageContent
}

const container = document.getElementById("root")
if (container) {
  const root = createRoot(container)
  root.render(
    <ErrorBoundary>
      <OptionsPage />
    </ErrorBoundary>
  )
}
