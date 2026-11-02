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
      // Native tests exercise shared logic, UI components and maintained tooling.
      // The merged browser report adds the application launchers below.
      include: [
        "src/**/*.{ts,tsx}",
        "entrypoints/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "scripts/**/*.{ts,tsx,js,mjs,cjs,mts,cts}",
      ],
      exclude: [
        "**/*.d.ts",
        "src/runtime/generated/**",
        "**/node_modules/**",
        // Isolated browser-test setup.
        "entrypoints/background/e2e-state-seed.ts",
        // Application launchers are exercised by the instrumented browser suite.
        "entrypoints/background/index.ts",
        "entrypoints/offscreen/main.ts",
        "entrypoints/options/main.tsx",
        "entrypoints/sidepanel/main.tsx",
        // Type-only modules.
        "entrypoints/offscreen/chapter-processing-types.ts",
        "entrypoints/sidepanel/types.ts",
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
