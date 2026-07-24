import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.output/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.{test,spec}.{js,ts}"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.{test,spec}.{js,ts}"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      // Include src/** plus high-risk, non-UI entrypoint runtime surfaces that
      // have meaningful unit/integration coverage. This keeps the coverage gate
      // on background queue, sender-resolution, state-action-router, offscreen
      // helpers, and options/sidepanel non-UI helpers instead of only src/**.
      //
      // UI components (.tsx) and React hooks remain exercised via Playwright
      // E2E and are excluded below; adding jsdom + React Testing Library unit
      // tests for them is a tracked follow-up. Runtime modules with dedicated
      // unit coverage stay in the gate, including the background routers and
      // listeners, one-shot page probes, and offscreen processing/bridge modules.
      include: [
        "src/**/*.ts",
        "entrypoints/background/**/*.ts",
        "entrypoints/offscreen/**/*.ts",
        "entrypoints/options/**/*.ts",
        "entrypoints/sidepanel/**/*.ts",
      ],
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "src/runtime/generated/**", // Generated registries (tested via E2E)
        // Reverse-engineered PUBLUS configuration decoding is validated by
        // Comic Nettai browser/live workflows using real transport data. It is
        // intentionally outside the unit gate because synthetic unit vectors
        // would duplicate the site algorithm rather than independently test it.
        "src/site-integrations/comicnettai/publus-config.ts",
        "**/node_modules/**",
        // UI components (.tsx) are exercised end-to-end via Playwright; they
        // are intentionally excluded from the unit/integration coverage gate.
        "entrypoints/**/*.tsx",
        "components/**/*.tsx",
        // Entry points that only wire the extension lifecycle and are
        // exercised by WXT/E2E rather than unit tests.
        "entrypoints/background/index.ts",
        // Compiled and registered only in deterministic mocked E2E builds.
        "entrypoints/background/e2e-state-seed.ts",
        "entrypoints/offscreen/main.ts",
        "entrypoints/offscreen/zip.worker.ts",
        "entrypoints/options/main.tsx",
        "entrypoints/sidepanel/main.tsx",
        // Pure type definition modules (no executable logic to cover).
        "entrypoints/offscreen/chapter-processing-types.ts",
        "entrypoints/sidepanel/types.ts",
        // React hooks that need jsdom + React Testing Library to exercise
        // meaningfully. They are covered by Playwright E2E today; adding RTL
        // unit tests for them is a tracked follow-up. Excluding them keeps the
        // coverage gate honest about what the unit/integration suites cover.
        "entrypoints/options/hooks/useOptionsPageState.ts",
        "entrypoints/options/hooks/useDownloadsTabState.ts",
        "entrypoints/sidepanel/hooks/useCommandCenterActions.ts",
        "entrypoints/sidepanel/hooks/useSidepanelTrackedTabId.ts",
        "entrypoints/sidepanel/hooks/useErrors.ts",
        "entrypoints/sidepanel/hooks/useSidepanelSeriesContext.ts",
        "entrypoints/sidepanel/hooks/useInlineSelectionState.ts",
        "entrypoints/sidepanel/hooks/useOptionsActionItems.ts",
        "entrypoints/sidepanel/hooks/useSelection.ts",
        "entrypoints/sidepanel/hooks/useDownload.ts",
        "entrypoints/sidepanel/hooks/useQueueView.ts",
        "entrypoints/sidepanel/hooks/useChapterSelections.ts",
        "entrypoints/sidepanel/hooks/useInitFailure.ts",
        "entrypoints/sidepanel/hooks/useActiveTaskProgress.ts",
        // These runtime helpers are only reachable from the excluded pure
        // offscreen bootstrap and do not yet have direct unit tests.
        "entrypoints/offscreen/error-categories.ts",
        "entrypoints/offscreen/status-ui.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
})
