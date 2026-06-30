import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.output/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.{test,spec}.{js,ts}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Include src/** plus high-risk, non-UI entrypoint runtime surfaces that
      // have meaningful unit/integration coverage. This keeps the coverage gate
      // on background queue, sender-resolution, state-action-router, offscreen
      // helpers, and options/sidepanel non-UI helpers instead of only src/**.
      //
      // UI components (.tsx) and React hooks remain exercised via Playwright
      // E2E and are excluded below; adding jsdom + React Testing Library unit
      // tests for them is a tracked follow-up. A small set of runtime modules
      // that need additional unit tests before they can join the gate (e.g.
      // background-message-router, offscreen/runtime-bridge) are also excluded
      // with a comment so the gate stays honest about what is actually tested.
      include: [
        'src/**/*.ts',
        'entrypoints/background/**/*.ts',
        'entrypoints/content/**/*.ts',
        'entrypoints/offscreen/**/*.ts',
        'entrypoints/options/**/*.ts',
        'entrypoints/sidepanel/**/*.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        'src/runtime/generated/**', // Generated registries (tested via E2E)
        'src/runtime/site-integration-content-initialization.ts', // Content-script context (tested via E2E)
        'src/site-integrations/*/content-runtime.ts', // Content-script context (tested via E2E)
        '**/node_modules/**',
        // UI components (.tsx) are exercised end-to-end via Playwright; they
        // are intentionally excluded from the unit/integration coverage gate.
        'entrypoints/**/*.tsx',
        'components/**/*.tsx',
        // Entry points that only wire the extension lifecycle and are
        // exercised by WXT/E2E rather than unit tests.
        'entrypoints/background/index.ts',
        'entrypoints/content/index.ts',
        'entrypoints/offscreen/main.ts',
        'entrypoints/offscreen/zip.worker.ts',
        'entrypoints/options/main.tsx',
        'entrypoints/sidepanel/main.tsx',
        // Pure type definition modules (no executable logic to cover).
        'entrypoints/content/content-types.ts',
        'entrypoints/offscreen/chapter-processing-types.ts',
        'entrypoints/sidepanel/types.ts',
        // React hooks that need jsdom + React Testing Library to exercise
        // meaningfully. They are covered by Playwright E2E today; adding RTL
        // unit tests for them is a tracked follow-up. Excluding them keeps the
        // coverage gate honest about what the unit/integration suites cover.
        'entrypoints/options/hooks/useOptionsPageState.ts',
        'entrypoints/options/hooks/useDownloadsTabState.ts',
        'entrypoints/sidepanel/hooks/useCommandCenterActions.ts',
        'entrypoints/sidepanel/hooks/useSidepanelTrackedTabId.ts',
        'entrypoints/sidepanel/hooks/useErrors.ts',
        'entrypoints/sidepanel/hooks/useSidepanelSeriesContext.ts',
        'entrypoints/sidepanel/hooks/useInlineSelectionState.ts',
        'entrypoints/sidepanel/hooks/useOptionsActionItems.ts',
        'entrypoints/sidepanel/hooks/useSelection.ts',
        'entrypoints/sidepanel/hooks/useDownload.ts',
        'entrypoints/sidepanel/hooks/useQueueView.ts',
        'entrypoints/sidepanel/hooks/useChapterSelections.ts',
        'entrypoints/sidepanel/hooks/useInitFailure.ts',
        'entrypoints/sidepanel/hooks/useActiveTaskProgress.ts',
        'entrypoints/content/content-runtime.ts',
        // Runtime modules that need additional unit tests before joining the
        // coverage gate. They are exercised via E2E; excluding them here keeps
        // the gate honest. Tracked follow-up: add router/listener/bridge unit
        // tests so these can be removed from the exclude list.
        'entrypoints/background/background-message-router.ts',
        'entrypoints/background/background-navigation-listeners.ts',
        'entrypoints/background/background-runtime-listeners.ts',
        'entrypoints/background/background-startup.ts',
        'entrypoints/background/tab-ui-coordinator.ts',
        'entrypoints/background/offscreen-progress-handler.ts',
        'entrypoints/offscreen/chapter-processing.ts',
        'entrypoints/offscreen/runtime-bridge.ts',
        'entrypoints/offscreen/error-categories.ts',
        'entrypoints/offscreen/image-processor.ts',
        'entrypoints/offscreen/status-ui.ts',
        'entrypoints/options/components/downloads-tab-helpers.ts',
        'entrypoints/sidepanel/components/command-center-queue-helpers.ts',
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
      '@': path.resolve(__dirname, './'),
    },
  },
});
