import { describe, expect, it } from "vitest"
import config from "../../wxt.config"

type Manifest = {
  permissions?: string[]
  host_permissions?: string[]
  optional_host_permissions?: string[]
  minimum_chrome_version?: string
}

type ManifestConfig = {
  manifest?: Manifest | ((context: { mode: string }) => Manifest)
}

describe("extension manifest permissions", () => {
  const manifestConfig = (config as ManifestConfig).manifest
  const resolveManifest = (mode: string): Manifest =>
    typeof manifestConfig === "function"
      ? manifestConfig({ mode })
      : (manifestConfig ?? {})
  const productionManifest = resolveManifest("production")
  const liveTestManifest = resolveManifest("live-test")

  it("does not request direct cookie API access", () => {
    expect(productionManifest.permissions).not.toContain("cookies")
    expect(liveTestManifest.permissions).not.toContain("cookies")
  })

  it("keeps broad dynamic provider access optional", () => {
    expect(productionManifest.host_permissions).not.toContain("https://*/*")
    expect(productionManifest.host_permissions).not.toContain("<all_urls>")
    expect(productionManifest.optional_host_permissions).toEqual([
      "https://*/*",
    ])
    expect(productionManifest.host_permissions).toContain(
      "https://comic.pixiv.net/*"
    )
  })

  it("grants broad HTTPS access only to the isolated live-test build", () => {
    expect(liveTestManifest.host_permissions).toContain("https://*/*")
    expect(liveTestManifest.optional_host_permissions).toEqual([])
  })

  it("grants broad HTTPS access to the isolated deterministic E2E build", () => {
    const original = process.env.TAKO_E2E_STATE_SEED
    process.env.TAKO_E2E_STATE_SEED = "true"
    try {
      const deterministicE2eManifest = resolveManifest("e2e-test")
      expect(deterministicE2eManifest.host_permissions).toContain("https://*/*")
      expect(deterministicE2eManifest.optional_host_permissions).toEqual([])

      expect(productionManifest.host_permissions).not.toContain("https://*/*")
      expect(productionManifest.optional_host_permissions).toEqual([
        "https://*/*",
      ])
    } finally {
      if (original === undefined) {
        delete process.env.TAKO_E2E_STATE_SEED
      } else {
        process.env.TAKO_E2E_STATE_SEED = original
      }
    }
  })

  it("targets the current Chrome release baseline", () => {
    expect(productionManifest.minimum_chrome_version).toBe("150")
    expect(liveTestManifest.minimum_chrome_version).toBe("150")
  })
})
