import { defineConfig } from "vitest/config"
import nativeConfig from "./vitest.config"
import { serializedPageProbeModules } from "./scripts/page-probe-instrumentation"

export default defineConfig({
  ...nativeConfig,
  test: {
    ...nativeConfig.test,
    coverage: {
      ...nativeConfig.test?.coverage,
      provider: "istanbul",
      reportsDirectory: "coverage/runtime",
      include: [
        "src/**/*.{ts,tsx}",
        "entrypoints/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
      ],
      exclude: [
        ...(nativeConfig.test?.coverage?.exclude ?? []),
        ...serializedPageProbeModules,
      ],
    },
  },
})
