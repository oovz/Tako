/** Tako options page. */
import { createRoot } from "react-dom/client"
import "@/globals.css"
import "./options.css"

import { ErrorBoundary } from "@/src/ui/shared/components/ErrorBoundary"
import { OptionsPage } from "./main-options-page"

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <OptionsPage />
    </ErrorBoundary>
  )
}
