import { resolveConfig } from "vite"
import type { ConfigEnv } from "wxt"
import { afterEach, describe, expect, it, vi } from "vitest"
import config from "@/wxt.config"
import { siteIntegrationWxtPermissions } from "@/src/runtime/generated/site-integration-wxt-permissions"

const modes = [
  {
    mode: "production",
    seed: undefined,
    coverage: undefined,
    state: false,
    redirects: false,
    instrument: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "production",
    seed: "true",
    coverage: "true",
    state: false,
    redirects: false,
    instrument: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "development",
    seed: "true",
    coverage: "true",
    state: false,
    redirects: false,
    instrument: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "live-test",
    seed: undefined,
    coverage: undefined,
    state: true,
    redirects: false,
    instrument: false,
    broad: true,
    loopback: false,
  },
  {
    mode: "live-test",
    seed: "true",
    coverage: "true",
    state: true,
    redirects: false,
    instrument: false,
    broad: true,
    loopback: false,
  },
  {
    mode: "e2e-test",
    seed: undefined,
    coverage: undefined,
    state: false,
    redirects: false,
    instrument: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "e2e-test",
    seed: "true",
    coverage: "false",
    state: true,
    redirects: true,
    instrument: false,
    broad: true,
    loopback: true,
  },
  {
    mode: "e2e-test",
    seed: "false",
    coverage: "true",
    state: false,
    redirects: false,
    instrument: true,
    broad: false,
    loopback: false,
  },
  {
    mode: "e2e-test",
    seed: "true",
    coverage: "true",
    state: true,
    redirects: true,
    instrument: true,
    broad: true,
    loopback: true,
  },
  {
    mode: "e2e-test",
    seed: "TRUE",
    coverage: "TRUE",
    state: false,
    redirects: false,
    instrument: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "staging",
    seed: "true",
    coverage: "true",
    state: false,
    redirects: false,
    instrument: false,
    broad: false,
    loopback: false,
  },
]

afterEach(() => vi.unstubAllEnvs())

describe("WXT configuration consumers", () => {
  it.each(modes)(
    "isolates capabilities for $mode with seed=$seed and coverage=$coverage",
    async (test) => {
      vi.stubEnv("TAKO_E2E_STATE_SEED", test.seed)
      vi.stubEnv("E2E_COVERAGE", test.coverage)
      const environment: ConfigEnv = {
        mode: test.mode,
        command: test.mode === "development" ? "serve" : "build",
        browser: "chrome",
        manifestVersion: 3,
      }
      if (!config.vite || typeof config.manifest !== "function")
        throw new Error("WXT configuration callbacks are required")
      const viteConfig = await config.vite(environment)
      const manifest = await config.manifest(environment)
      const resolved = await resolveConfig(
        { ...viteConfig, configFile: false },
        "build",
        test.mode
      )
      const definitions = resolved.define
      if (!definitions) throw new Error("Vite build definitions are required")
      expect(JSON.parse(definitions.__TAKO_E2E_STATE_SEED__)).toBe(test.state)
      expect(JSON.parse(definitions.__TAKO_E2E_REDIRECTS__)).toBe(
        test.redirects
      )
      expect(
        resolved.plugins.some((plugin) => plugin.name === "vite:istanbul")
      ).toBe(test.instrument)
      expect(resolved.build.modulePreload).toBe(false)
      const required = [...siteIntegrationWxtPermissions.requiredOrigins]
      const optional = [...siteIntegrationWxtPermissions.optionalOrigins]
      expect(manifest.host_permissions).toEqual(
        test.broad
          ? [
              ...required,
              ...optional,
              ...(test.loopback ? ["http://127.0.0.1/*"] : []),
            ]
          : required
      )
      expect(manifest.optional_host_permissions).toEqual(
        test.broad ? [] : optional
      )
    }
  )

  it("creates independent plugin instances for each Vite build step", async () => {
    vi.stubEnv("E2E_COVERAGE", "true")
    if (!config.vite)
      throw new Error("WXT Vite configuration callback is required")
    const environment: ConfigEnv = {
      mode: "e2e-test",
      command: "build",
      browser: "chrome",
      manifestVersion: 3,
    }
    const first = await resolveConfig(
      { ...(await config.vite(environment)), configFile: false },
      "build",
      environment.mode
    )
    const second = await resolveConfig(
      { ...(await config.vite(environment)), configFile: false },
      "build",
      environment.mode
    )
    const firstInstrumenter = first.plugins.find(
      (plugin) => plugin.name === "vite:istanbul"
    )
    const secondInstrumenter = second.plugins.find(
      (plugin) => plugin.name === "vite:istanbul"
    )
    expect(firstInstrumenter).toBeDefined()
    expect(secondInstrumenter).toBeDefined()
    expect(firstInstrumenter).not.toBe(secondInstrumenter)
  })
})
