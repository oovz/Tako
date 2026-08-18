import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-collapsible": "mock" }, children),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

import { SiteIntegrationCard } from "@/entrypoints/options/components/SiteIntegrationCard"
import { SiteIntegrationManagementTab } from "@/entrypoints/options/tabs/SiteIntegrationManagementTab"
import {
  assertValidSettingsFieldSchema,
  getDefinition,
} from "@/src/site-integrations/catalog"
import type { SiteIntegrationSettingsField as SettingsFieldSchema } from "@/src/site-integrations/definition-types"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

describe("Site integration custom settings contract", () => {
  it("requires a non-empty, internally consistent option set", () => {
    expect(() =>
      assertValidSettingsFieldSchema({
        id: "languages",
        labelKey: "mangadexSetting_chapterLanguageFilterLabel",
        type: "multiselect",
        defaultValue: [],
      } as unknown as SettingsFieldSchema)
    ).toThrow(/requires non-empty options/)

    expect(() =>
      assertValidSettingsFieldSchema({
        id: "quality",
        labelKey: "mangadexSetting_imageQualityLabel",
        type: "select",
        defaultValue: "missing",
        options: [
          {
            labelKey: "mangadexSetting_imageQualityOption_dataSaver",
            value: "data-saver",
          },
        ],
      })
    ).toThrow(/Invalid value/)

    expect(() =>
      assertValidSettingsFieldSchema({
        id: "languages",
        labelKey: "mangadexSetting_chapterLanguageFilterLabel",
        type: "multiselect",
        defaultValue: [],
        options: [
          {
            labelKey: "mangadexSetting_chapterLanguageFilterOption_en",
            value: "en",
          },
          {
            labelKey: "mangadexSetting_chapterLanguageFilterOption_en",
            value: "en",
          },
        ],
      })
    ).toThrow(/duplicate option value/)
  })

  it("renders dynamic custom setting controls with per-setting enable toggle", () => {
    const mangadex = getDefinition("mangadex")
    expect(mangadex).toBeDefined()

    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationCard, {
        siteIntegration: {
          id: mangadex!.id,
          name: mangadex!.name,
          domains: mangadex!.patterns.domains,
          customSettings: [...mangadex!.customSettings],
        },
        isEnabled: true,
        override: undefined,
        globalDefaults: {
          outputFormat: "cbz",
          imagePolicy: { concurrency: 2, delayMs: 500 },
          chapterPolicy: { concurrency: 1, delayMs: 500 },
        },
        siteIntegrationSettingsValues: {},
        onEnabledChange: vi.fn(),
        onSiteIntegrationSettingsChange: vi.fn(),
        onChange: vi.fn(),
      })
    )

    expect(html).toContain("Custom settings")
    expect(html).toContain("Enabled")
    expect(html).toContain("Enable override")
    expect(html).toContain('for="mangadex-custom-imageQuality-enabled"')
    expect(html).toContain('id="mangadex-custom-imageQuality-enabled"')
    expect(html).toContain("Image quality")
  })

  it("renders the Site Integrations tab from manifest data before registry initialization", () => {
    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationManagementTab, {
        overrides: {},
        siteIntegrationEnablement: {},
        globalSettings: DEFAULT_SETTINGS,
        siteIntegrationSettingsByIntegration: {},
        onSiteIntegrationSettingsChange: vi.fn(),
        onSiteIntegrationEnablementChange: vi.fn(),
        onChange: vi.fn(),
      })
    )

    expect(html).toContain('data-testid="site-integration-card-mangadex"')
    expect(html).toContain('data-testid="site-integration-card-manhuagui"')
    expect(html).not.toContain("v1.0.0")
  })

  it("renders a single contributor name in SiteIntegrationCard", () => {
    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationCard, {
        siteIntegration: {
          id: "test-site",
          name: "Test Site",
          contributors: ["Solo Contributor"],
          domains: ["test.example.com"],
        },
        isEnabled: true,
        globalDefaults: {
          outputFormat: "cbz",
          imagePolicy: { concurrency: 2, delayMs: 500 },
          chapterPolicy: { concurrency: 1, delayMs: 500 },
        },
        onChange: vi.fn(),
      })
    )

    expect(html).toContain("Contributor: Solo Contributor")
  })

  it("renders multiple contributor names in SiteIntegrationCard", () => {
    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationCard, {
        siteIntegration: {
          id: "multi-author-site",
          name: "Multi Author Site",
          contributors: ["Alice", "Bob", "Charlie"],
          domains: ["multi.example.com"],
        },
        isEnabled: true,
        globalDefaults: {
          outputFormat: "cbz",
          imagePolicy: { concurrency: 2, delayMs: 500 },
          chapterPolicy: { concurrency: 1, delayMs: 500 },
        },
        onChange: vi.fn(),
      })
    )

    expect(html).toContain("Contributors: Alice, Bob, Charlie")
  })

  it("renders contributors from manifest when rendering SiteIntegrationManagementTab", () => {
    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationManagementTab, {
        overrides: {},
        siteIntegrationEnablement: {},
        globalSettings: DEFAULT_SETTINGS,
        siteIntegrationSettingsByIntegration: {},
        onSiteIntegrationSettingsChange: vi.fn(),
        onSiteIntegrationEnablementChange: vi.fn(),
        onChange: vi.fn(),
      })
    )

    expect(html).toContain("Contributor: TMD Team")
  })
})
