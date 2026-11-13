// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { SiteIntegrationsTab } from "@/entrypoints/options/tabs/SiteIntegrationsTab"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { siteIntegrationCatalog } from "@/src/site-integrations/catalog"
import { t } from "@/src/runtime/i18n"

let root: Root
let container: HTMLDivElement
const props = {
  overrides: {
    comictropics: { retries: { image: 0 } },
    mangadex: { outputFormat: "zip" as const },
  },
  siteIntegrationEnablement: { mangadex: false },
  globalSettings: DEFAULT_SETTINGS,
  siteIntegrationSettingsByIntegration: {
    mangadex: { autoReadMangaDexSettings: false },
  },
  onSiteIntegrationSettingsChange: vi.fn(),
  onSiteIntegrationEnablementChange: vi.fn(),
  onChange: vi.fn(),
}

function cards() {
  return Array.from(
    container.querySelectorAll('[data-testid^="site-integration-card-"]')
  ).map((card) =>
    card.getAttribute("data-testid")!.replace("site-integration-card-", "")
  )
}

async function filter(key: Parameters<typeof t>[0]) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.startsWith(t(key))
  )
  expect(button).toBeDefined()
  await act(async () => button!.click())
}

async function search(value: string) {
  const input = container.querySelector("input")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(SiteIntegrationsTab, props)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it("lists shipped integrations with each overridden integration counted once and sorted first", async () => {
  expect(cards()).toHaveLength(
    siteIntegrationCatalog.filter((item) => item.shipped).length
  )
  expect(cards().slice(0, 2)).toEqual(["comictropics", "mangadex"])
  const overridesButton = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === `${t("common_overrides")} (2)`
  )
  expect(overridesButton).toBeDefined()
  const viewOverrides = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === "View overrides"
  )
  expect(viewOverrides).toBeDefined()
  expect(container.textContent).toContain("2 site integrations have overrides.")
  await act(async () => viewOverrides!.click())
  expect(cards()).toEqual(["comictropics", "mangadex"])
  expect(container.contains(viewOverrides!)).toBe(false)
})

it("ignores provider preferences and empty records in the override summary and filter", async () => {
  await act(async () =>
    root.render(
      createElement(SiteIntegrationsTab, {
        ...props,
        overrides: { comictropics: { retries: {} } },
      })
    )
  )
  expect(container.textContent).not.toContain("View overrides")
  expect(container.textContent).not.toContain("Overrides (")
  expect(cards()).toContain("mangadex")
})

it("combines explicit enablement and search while preserving catalog defaults", async () => {
  await filter("common_disabled")
  expect(cards()).toContain("mangadex")
  await search("  MANGADEX  ")
  expect(cards()).toEqual(["mangadex"])
  await filter("common_enabled")
  expect(cards()).toEqual([])
  expect(container.textContent).toContain(t("options_noIntegrationsFound"))
  await filter("common_all")
  await search("api.mangadex.org")
  // Searches provider page domains, rather than unrelated API permissions.
  expect(cards()).toEqual([])
  await search("mangadex.org")
  expect(cards()).toEqual(["mangadex"])
  await search("Otaro")
  expect(cards()).toContain("animemangahouse")
})

it("preserves integration identity when toggling enablement from a filtered list", async () => {
  await search("mangadex")
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
  await act(async () => toggle.click())
  expect(
    props.onSiteIntegrationEnablementChange
  ).toHaveBeenCalledExactlyOnceWith("mangadex", true)
})

it("filters a single override for reset and keeps all integrations reachable afterward", async () => {
  const single = {
    ...props,
    overrides: { mangadex: { outputFormat: "zip" as const } },
    siteIntegrationSettingsByIntegration: {},
  }
  await act(async () => root.render(createElement(SiteIntegrationsTab, single)))
  expect(container.textContent).toContain("1 site integration has overrides.")
  await filter("common_overrides")
  expect(cards()).toEqual(["mangadex"])
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        '[data-testid="configure-site-integration-mangadex"]'
      )!
      .click()
  )
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        '[data-testid="reset-site-integration-overrides-mangadex"]'
      )!
      .click()
  )
  expect(props.onChange).toHaveBeenCalledExactlyOnceWith("mangadex", null)
  await act(async () =>
    root.render(
      createElement(SiteIntegrationsTab, { ...single, overrides: {} })
    )
  )
  await filter("common_all")
  expect(cards()).toHaveLength(
    siteIntegrationCatalog.filter((integration) => integration.shipped).length
  )
  await filter("common_disabled")
  expect(cards()).toContain("mangadex")
  await filter("common_enabled")
  expect(cards().length).toBeGreaterThan(0)
})
