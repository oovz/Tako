import { createRoot } from 'react-dom/client'
import '@/globals.css'
import React from 'react'
import { SidePanelApp } from '@/entrypoints/sidepanel/SidePanelApp'

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <SidePanelApp />
    </React.StrictMode>
  )
}

