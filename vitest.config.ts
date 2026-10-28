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
      // Executable source and extension runtime modules.
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
        // PUBLUS decoding is checked by browser and live workflows.
        "src/site-integrations/comictropics/publus-config.ts",
        "**/node_modules/**",
        // Browser-tested UI components.
        "entrypoints/**/*.tsx",
        "components/**/*.tsx",
        // Lifecycle entrypoints exercised by browser tests.
        "entrypoints/background/index.ts",
        // Isolated browser-test state setup.
        "entrypoints/background/e2e-state-seed.ts",
        "entrypoints/offscreen/main.ts",
        "entrypoints/offscreen/zip.worker.ts",
        "entrypoints/options/main.tsx",
        "entrypoints/sidepanel/main.tsx",
        // Type-only modules.
        "entrypoints/offscreen/chapter-processing-types.ts",
        "entrypoints/sidepanel/types.ts",
        // UI hooks exercised by browser tests.
        "entrypoints/options/hooks/useOptionsPageState.ts",
        "entrypoints/options/hooks/useOptionsFolderManagement.ts",
        "entrypoints/options/hooks/useOptionsHistory.ts",
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
        "src/ui/shared/hooks/useChromeStorageValue.ts",
        "src/ui/shared/hooks/useUiPreferences.ts",
        // Status presentation is covered through the offscreen/browser runtime.
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
