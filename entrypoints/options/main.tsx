/**
 * Tako Manga Downloader - Options Page
 * Refactored with sidebar navigation following shadcn/ui patterns
 */

import { createRoot } from 'react-dom/client'
import '@/globals.css'
import { useState, lazy, Suspense, Profiler, useEffect } from "react"
import { Toaster } from "@/components/ui/sonner"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import logger from '@/src/runtime/logger'
import { getInitialOptionsSection, type OptionsSection } from './tab-routing'
import { useOptionsPageState } from './hooks/useOptionsPageState'

import { GlobalSettingsTab } from './tabs/GlobalSettingsTab'

// Lazy load non-default tabs for code splitting
const SiteIntegrationManagementTab = lazy(() => import('./tabs/SiteIntegrationManagementTab').then(m => ({ default: m.SiteIntegrationManagementTab })))
const HistoryTab = lazy(() => import('./tabs/HistoryTab').then(m => ({ default: m.HistoryTab })))
const DownloadsTab = lazy(() => import('./tabs/DownloadsTab').then(m => ({ default: m.DownloadsTab })))

// Debug settings component (imported directly since it's small)
import { DebugSettingsSection } from './components/DebugSettingsSection'
import { OptionsSidebar } from './components/OptionsSidebar'
import { SectionLoadingSkeleton } from './components/SectionLoadingSkeleton'
import { UnsavedChangesFooter } from './components/UnsavedChangesFooter'

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
      improvement: baseDuration > 0 ? `${((1 - actualDuration / baseDuration) * 100).toFixed(1)}%` : 'N/A'
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
    isSaving,
    isClearing,
    isPickingFolder,
    hasUnsavedChanges,
    handleSettingsChange,
    handleSiteIntegrationSettingsChange,
    handleOverrideChange,
    handleSiteIntegrationEnablementChange,
    pickDownloadFolder,
    saveConfiguration,
    clearAllHistory,
    clearSeriesHistory,
    handleRefreshHistory,
    discardChanges,
  } = useOptionsPageState()
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const [activeSection, setActiveSection] = useState<OptionsSection>(() => getInitialOptionsSection(window.location.search))

  useEffect(() => {
    const root = document.getElementById('root')
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    const previousRootOverflow = root?.style.overflow ?? ''

    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    if (root) {
      root.style.overflow = 'hidden'
    }

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      if (root) {
        root.style.overflow = previousRootOverflow
      }
    }
  }, [])

  if (isLoading || !settings || !settingsBuffer) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <Profiler id="OptionsPage" onRender={onRenderCallback}>
      <div className="flex h-full min-h-0 overflow-hidden bg-background text-foreground font-sans antialiased">
        <Toaster />

        <OptionsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

        {/* Main Content - following shadcn/ui dashboard patterns */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col p-8 pb-24">
            {activeSection === 'global' && (
              <section className="animate-in fade-in slide-in-from-right-4 duration-300">
                <GlobalSettingsTab
                  settings={settingsBuffer}
                  onChange={handleSettingsChange}
                />
              </section>
            )}

            {activeSection === 'integrations' && (
              <section className="animate-in fade-in slide-in-from-right-4 duration-300">
                <Suspense fallback={<SectionLoadingSkeleton />}>
                  <SiteIntegrationManagementTab
                    overrides={overrides}
                    siteIntegrationEnablement={siteIntegrationEnablement}
                    globalSettings={settingsBuffer}
                    siteIntegrationSettingsByIntegration={siteIntegrationSettingsByIntegration}
                    onSiteIntegrationSettingsChange={handleSiteIntegrationSettingsChange}
                    onSiteIntegrationEnablementChange={handleSiteIntegrationEnablementChange}
                    onChange={handleOverrideChange}
                  />
                </Suspense>
              </section>
            )}

            {activeSection === 'downloads' && (
              <section className="animate-in fade-in slide-in-from-right-4 duration-300">
                <Suspense fallback={<SectionLoadingSkeleton />}>
                  <DownloadsTab
                    settings={settingsBuffer}
                    onChange={handleSettingsChange}
                    selectedFolderName={selectedFolderName}
                    onPickFolder={pickDownloadFolder}
                    isPickingFolder={isPickingFolder}
                  />
                </Suspense>
              </section>
            )}

            {activeSection === 'debug' && (
              <section className="animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex flex-col gap-6">
                  {/* Debug Settings Section */}
                  <DebugSettingsSection
                    settings={settingsBuffer}
                    onChange={handleSettingsChange}
                  />

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
            onDiscard={() => setShowDiscardDialog(true)}
            onSave={saveConfiguration}
          />
        )}

        {/* Discard confirmation dialog */}
        <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                All unsaved changes will be lost. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  discardChanges()
                  setShowDiscardDialog(false)
                }}
              >
                Discard Changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Profiler>
  )
}

// Mount the application
const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<OptionsPage />)
}

