import { createRoot } from "react-dom/client"
import "@/globals.css"
import React from "react"
import { SidePanelApp } from "@/entrypoints/sidepanel/SidePanelApp"
import { ErrorBoundary } from "@/src/ui/shared/components/ErrorBoundary"
import logger from "@/src/runtime/logger"
import { applyUiPreferences } from "@/src/ui/shared/ui-preferences"
import { loadUiPreferences } from "@/src/ui/shared/ui-preferences-client"

const rootEl = document.getElementById("root")
if (rootEl) {
  const initializeSidePanel = async () => {
    try {
      await applyUiPreferences(await loadUiPreferences())
    } catch (error) {
      // A preferences read or application failure must not prevent the panel
      // from rendering its ErrorBoundary and recoverable default UI.
      logger.error("[SidePanel] Failed to apply initial UI preferences:", error)
    }

    createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary>
          <SidePanelApp />
        </ErrorBoundary>
      </React.StrictMode>
    )
  }

  void initializeSidePanel()
}
