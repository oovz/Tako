import { Component, type ErrorInfo, type ReactNode } from "react"
import { t } from "@/src/runtime/i18n"

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Root-level error boundary for extension pages.
 *
 * Catches uncaught render errors that would otherwise produce a blank
 * extension page with no recovery path. Renders a minimal fallback UI
 * with a reset button.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught render error:", error, info)
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset)
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: "2rem",
            gap: "1rem",
            fontFamily: "system-ui, sans-serif",
            color: "#dc2626",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
            {t("errorBoundary_title")}
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
            {t("errorBoundary_description")}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              background: "#f9fafb",
              cursor: "pointer",
            }}
          >
            {t("errorBoundary_tryAgain")}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
