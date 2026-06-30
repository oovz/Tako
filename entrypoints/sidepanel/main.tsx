import { createRoot } from 'react-dom/client'
import '@/globals.css'
import React from 'react'
import { SidePanelApp } from '@/entrypoints/sidepanel/SidePanelApp'
import { ErrorBoundary } from '@/src/ui/shared/components/ErrorBoundary'

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <SidePanelApp />
      </ErrorBoundary>
    </React.StrictMode>
  )
}

