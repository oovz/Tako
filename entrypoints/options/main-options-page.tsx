import { lazy, Profiler, Suspense, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import { Toaster } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { useOptionsPageState } from "./hooks/useOptionsPageState"
import { OptionsSidebar } from "./components/OptionsSidebar"
import { SectionLoadingSkeleton } from "./components/SectionLoadingSkeleton"
import { UnsavedChangesFooter } from "./components/UnsavedChangesFooter"
import { ExternalSettingsConflictBanner } from "./components/ExternalSettingsConflictBanner"
import { OptionsDiscardDialog } from "./main-options-discard-dialog"
import {
  useOptionsNavigation,
  useOptionsPageDocument,
  useOptionsSaveShortcut,
  useOptionsUnloadGuard,
} from "./main-options-lifecycle"
import type { OptionsSection } from "./tab-routing"

const GeneralTab = lazy(() =>
  import("./tabs/GeneralTab").then((module) => ({ default: module.GeneralTab }))
)
const StorageTab = lazy(() =>
  import("./tabs/StorageTab").then((module) => ({ default: module.StorageTab }))
)
const NetworkTab = lazy(() =>
  import("./tabs/NetworkTab").then((module) => ({ default: module.NetworkTab }))
)
const SiteIntegrationsTab = lazy(() =>
  import("./tabs/SiteIntegrationsTab").then((module) => ({
    default: module.SiteIntegrationsTab,
  }))
)
const ActivityTab = lazy(() =>
  import("./tabs/ActivityTab").then((module) => ({
    default: module.ActivityTab,
  }))
)

type OptionsState = ReturnType<typeof useOptionsPageState>
type LoadedOptionsState = OptionsState & { settingsBuffer: ExtensionSettings }
type OptionsNavigation = ReturnType<typeof useOptionsNavigation>

function onRenderCallback(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number
) {
  logger.debug(`[Profiler] ${id} - ${phase}`, {
    actualDuration: `${actualDuration.toFixed(2)}ms`,
    baseDuration: `${baseDuration.toFixed(2)}ms`,
    improvement:
      baseDuration > 0
        ? `${((1 - actualDuration / baseDuration) * 100).toFixed(1)}%`
        : "N/A",
  })
}

function OptionsTabContent({
  state,
  activeSection,
}: {
  state: LoadedOptionsState
  activeSection: OptionsSection
}) {
  switch (activeSection) {
    case "general":
      return (
        <GeneralTab
          settings={state.settingsBuffer}
          onChange={state.handleSettingsChange}
        />
      )
    case "storage":
      return (
        <StorageTab
          settings={state.settingsBuffer}
          onChange={state.handleSettingsChange}
          selectedFolderName={state.selectedFolderName}
          folderAccessRequired={state.folderAccessRequired}
          onPickFolder={state.pickDownloadFolder}
          onGrantFolderAccess={state.grantDownloadFolderAccess}
          isPickingFolder={state.isPickingFolder}
          isSaving={state.isSaving}
        />
      )
    case "network":
      return (
        <NetworkTab
          settings={state.settingsBuffer}
          onChange={state.handleSettingsChange}
        />
      )
    case "integrations":
      return (
        <SiteIntegrationsTab
          overrides={state.overrides}
          siteIntegrationEnablement={state.siteIntegrationEnablement}
          globalSettings={state.settingsBuffer}
          siteIntegrationSettingsByIntegration={
            state.siteIntegrationSettingsByIntegration
          }
          onSiteIntegrationSettingsChange={
            state.handleSiteIntegrationSettingsChange
          }
          onSiteIntegrationEnablementChange={
            state.handleSiteIntegrationEnablementChange
          }
          onChange={state.handleOverrideChange}
        />
      )
    case "activity":
      return (
        <ActivityTab
          stats={state.historyStats}
          series={state.historySeries}
          onClearChapterHistory={state.clearChapterHistory}
          onClearSeriesHistory={state.clearSeriesHistory}
          onRefreshSeries={state.handleRefreshHistory}
          isClearingHistory={state.isClearing}
        />
      )
  }
}

function OptionsWorkspace({
  state,
  navigation,
}: {
  state: LoadedOptionsState
  navigation: OptionsNavigation
}) {
  const { activeSection, handleSectionChange } = navigation
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const discardButtonRef = useRef<HTMLButtonElement>(null)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground font-sans antialiased lg:flex-row">
      <Toaster />
      <OptionsSidebar
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main
          ref={mainRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="@container mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
            {state.hasExternalChanges && (
              <ExternalSettingsConflictBanner
                isResolving={state.isResolvingExternalChanges}
                onReload={async () => {
                  await state.resolveExternalChanges("reload")
                }}
                onKeepMine={async () => {
                  await state.resolveExternalChanges("keep-mine")
                }}
              />
            )}
            <section
              key={activeSection}
              aria-labelledby={`options-${activeSection}-heading`}
            >
              <Suspense fallback={<SectionLoadingSkeleton />}>
                <OptionsTabContent
                  state={state}
                  activeSection={activeSection}
                />
              </Suspense>
            </section>
          </div>
        </main>
        {state.hasUnsavedChanges && (
          <UnsavedChangesFooter
            discardButtonRef={discardButtonRef}
            isSaving={state.isSaving}
            isSaveBlocked={
              state.hasExternalChanges || state.isResolvingExternalChanges
            }
            onDiscard={() => setShowDiscardDialog(true)}
            onSave={state.saveConfiguration}
          />
        )}
      </div>
      <OptionsDiscardDialog
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = discardButtonRef.current ?? mainRef.current
          target?.focus()
        }}
        open={showDiscardDialog}
        onOpenChange={setShowDiscardDialog}
        discardChanges={state.discardChanges}
      />
    </div>
  )
}

function OptionsPageContent({
  state,
  navigation,
}: {
  state: OptionsState
  navigation: OptionsNavigation
}) {
  if (state.loadFailed && (!state.settings || !state.settingsBuffer)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p role="alert" className="text-sm text-destructive">
            {t("options_toastLoadFailed")}
          </p>
          <Button type="button" variant="outline" onClick={state.retryLoad}>
            {t("common_restart")}
          </Button>
        </div>
      </div>
    )
  }
  if (state.isLoading || !state.settings || !state.settingsBuffer) {
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
  return (
    <OptionsWorkspace
      state={{ ...state, settingsBuffer: state.settingsBuffer }}
      navigation={navigation}
    />
  )
}

export function OptionsPage() {
  const state = useOptionsPageState()
  const navigation = useOptionsNavigation()
  useOptionsSaveShortcut(state)
  useOptionsUnloadGuard(state.hasUnsavedChanges)
  useOptionsPageDocument(state.settingsBuffer)
  const content = <OptionsPageContent state={state} navigation={navigation} />
  return import.meta.env.DEV ? (
    <Profiler id="OptionsPage" onRender={onRenderCallback}>
      {content}
    </Profiler>
  ) : (
    content
  )
}
