import { createRoot } from "react-dom/client"
import "@/globals.css"
import "./sidepanel.css"
import React from "react"
import { SidePanelApp } from "@/entrypoints/sidepanel/SidePanelApp"
import { ErrorBoundary } from "@/src/ui/shared/components/ErrorBoundary"
import { applyMotionPreference } from "@/src/ui/shared/ui-preferences"

const rootEl = document.getElementById("root")
if (rootEl) {
  // Keep the mounted panel still until the saved preference is applied.
  applyMotionPreference("reduce")
  createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <SidePanelApp />
      </ErrorBoundary>
    </React.StrictMode>
  )
}
