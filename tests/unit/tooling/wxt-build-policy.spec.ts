import { resolveConfig } from "vite"
import type { ConfigEnv } from "wxt"
import { afterEach, describe, expect, it, vi } from "vitest"
import config from "@/wxt.config"
import { siteIntegrationWxtPermissions } from "@/src/runtime/generated/site-integration-wxt-permissions"

const modes = [
  {
    mode: "production",
    seed: "true",
    state: false,
    redirects: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "development",
    seed: "true",
    state: false,
    redirects: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "live-test",
    seed: undefined,
    state: true,
    redirects: false,
    broad: true,
    loopback: false,
  },
  {
    mode: "e2e-test",
    seed: undefined,
    state: false,
    redirects: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "e2e-test",
    seed: "true",
    state: true,
    redirects: true,
    broad: true,
    loopback: true,
  },
  {
    mode: "e2e-test",
    seed: "TRUE",
    state: false,
    redirects: false,
    broad: false,
    loopback: false,
  },
  {
    mode: "staging",
    seed: "true",
    state: false,
    redirects: false,
    broad: false,
    loopback: false,
  },
]

afterEach(() => vi.unstubAllEnvs())

describe("WXT configuration consumers", () => {
  it.each(modes)(
    "isolates capabilities for $mode with seed=$seed",
    async (test) => {
      vi.stubEnv("TAKO_E2E_STATE_SEED", test.seed)
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
})
