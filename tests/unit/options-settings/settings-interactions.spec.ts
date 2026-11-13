import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
// @vitest-environment happy-dom

import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ArchiveFormatPicker } from "@/entrypoints/options/components/ArchiveFormatPicker"
import { CustomSettingField } from "@/entrypoints/options/components/CustomSettingField"
import { PathVisualization } from "@/entrypoints/options/components/PathVisualization"
import { RateLimitingForm } from "@/entrypoints/options/components/RateLimitingForm"
import { SiteIntegrationCard } from "@/entrypoints/options/components/SiteIntegrationCard"
import type { SiteIntegrationSettingsField } from "@/src/site-integrations/definition-types"
import { getSiteIntegrationList } from "@/entrypoints/options/tabs/SiteIntegrationsTab-model"

vi.mock("@/src/runtime/i18n", () => ({
  t: (key: string, args: string[] = []) => [key, ...args].join(":"),
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(element: Parameters<Root["render"]>[0]) {
  await act(async () => root.render(element))
}

async function click(selector: string) {
  const control = document.querySelector<HTMLElement>(selector)
  expect(control, selector).not.toBeNull()
  await act(async () => control!.click())
}

async function enter(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)
  expect(input, selector).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input!.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function select(selector: string, value: string) {
  const trigger = container.querySelector<HTMLElement>(selector)!
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
  })
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]')
  ).find((item) => item.textContent === value)
  expect(option).toBeDefined()
  await act(async () => option!.click())
}

function source(id: string) {
  const control = container.querySelector(`#${id}`)!
  const descriptions =
    control.getAttribute("aria-describedby")?.split(" ") ?? []
  return descriptions.map((id) => document.getElementById(id)?.textContent)
}

describe("rate policy controls", () => {
  it("keeps zero overrides and resolves each field's value and source independently", async () => {
    await render(
      createElement(RateLimitingForm, {
        integrationId: "site",
        scope: "image",
        value: { delayMs: 0 },
        onChange: vi.fn(),
        globalValue: { concurrency: 8, delayMs: 900 },
        siteIntegrationDefault: { concurrency: 3, delayMs: 200 },
        showHierarchy: true,
      })
    )
    expect(
      container.querySelector<HTMLInputElement>("#site-image-concurrency")!
        .placeholder
    ).toBe("options_defaultValue:3")
    expect(
      container.querySelector<HTMLInputElement>("#site-image-delay")!.value
    ).toBe("0")
    expect(source("site-image-concurrency")).toContain(
      "options_siteIntegrationDefault"
    )
    expect(source("site-image-delay")).toContain("options_override")
    expect(container.textContent).toContain("options_override")
    expect(container.textContent).toContain("options_usingValue:3")
    expect(container.textContent).not.toContain("options_usingMs")
  })

  it("inherits global zero delay and built-in defaults without inventing an override", async () => {
    const props = {
      integrationId: "site",
      scope: "image" as const,
      value: {},
      onChange: vi.fn(),
      showHierarchy: true,
    }
    await render(
      createElement(RateLimitingForm, {
        ...props,
        globalValue: { concurrency: 6, delayMs: 0 },
      })
    )
    expect(container.textContent).toContain("options_usingMs:0")
    expect(container.textContent).toContain("options_usingValue:6")
    await render(createElement(RateLimitingForm, props))
    expect(
      container.querySelector<HTMLInputElement>("#site-image-concurrency")!
        .placeholder
    ).toBe("options_defaultValue:2")
    expect(
      container.querySelector<HTMLInputElement>("#site-image-delay")!
        .placeholder
    ).toBe("options_defaultValue:500")
    expect(container.textContent).not.toContain("options_policyHierarchy")
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it("clamps distinct field ranges, truncates integers, and clears only the edited override", async () => {
    const onChange = vi.fn()
    await render(
      createElement(RateLimitingForm, {
        integrationId: "site",
        scope: "image",
        value: { concurrency: 4, delayMs: 100 },
        onChange,
      })
    )
    await enter("#site-image-concurrency", "99")
    expect(onChange).toHaveBeenLastCalledWith({ concurrency: 10, delayMs: 100 })
    await enter("#site-image-concurrency", "0")
    expect(onChange).toHaveBeenLastCalledWith({ concurrency: 1, delayMs: 100 })
    await enter("#site-image-delay", "0")
    expect(onChange).toHaveBeenLastCalledWith({ concurrency: 4, delayMs: 0 })
    await enter("#site-image-delay", "5001")
    expect(onChange).toHaveBeenLastCalledWith({ concurrency: 4, delayMs: 5000 })
    await enter("#site-image-delay", "42.9")
    expect(onChange).toHaveBeenLastCalledWith({ concurrency: 4, delayMs: 42 })
    await enter("#site-image-delay", "")
    expect(onChange).toHaveBeenLastCalledWith({
      concurrency: 4,
      delayMs: undefined,
    })
  })

  it("shows chapter delay hierarchy without concurrency and disables inputs when requested", async () => {
    await render(
      createElement(RateLimitingForm, {
        integrationId: "site",
        scope: "chapter",
        value: {},
        onChange: vi.fn(),
        showConcurrency: false,
        showHierarchy: true,
        disabled: true,
        siteIntegrationDefault: { delayMs: 0 },
        globalValue: { concurrency: 1, delayMs: 700 },
      })
    )
    expect(container.querySelector("#site-chapter-concurrency")).toBeNull()
    expect(
      container.querySelector<HTMLInputElement>("#site-chapter-delay")!.disabled
    ).toBe(true)
    expect(container.textContent).toContain("options_msDelay:0")
    expect(container.textContent).not.toContain("options_concurrentDelay")
  })
})

const customSchemas: SiteIntegrationSettingsField[] = [
  { id: "bool", type: "boolean", labelKey: "Boolean", defaultValue: false },
  { id: "text", type: "string", labelKey: "Text", defaultValue: "default" },
  { id: "number", type: "number", labelKey: "Number", defaultValue: 5 },
  {
    id: "select",
    type: "select",
    labelKey: "Selection",
    defaultValue: "a",
    options: [
      { value: "a", labelKey: "A" },
      { value: "b", labelKey: "B" },
    ],
  },
  {
    id: "multi",
    type: "multiselect",
    labelKey: "Languages",
    descriptionKey: "Language description",
    defaultValue: [],
    options: [
      { value: "en", labelKey: "English" },
      { value: "ja", labelKey: "Japanese" },
    ],
  },
]

describe("custom setting controls", () => {
  it("displays a stored string before reporting an edit", async () => {
    const schema = customSchemas[1]!
    const onChange = vi.fn()
    await render(
      createElement(CustomSettingField, {
        integrationId: "site",
        schema,
        effectiveValue: "saved text",
        onChange,
      })
    )
    expect(
      container.querySelector<HTMLInputElement>("#site-custom-text")!.value
    ).toBe("saved text")
    await enter("#site-custom-text", "edited text")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("edited text")
  })

  it.each([
    { schema: customSchemas[0]!, value: false, expected: true },
    { schema: customSchemas[1]!, value: "old", expected: "new" },
    { schema: customSchemas[2]!, value: 5, expected: 0 },
  ])(
    "reports edits for $schema.type fields",
    async ({ schema, value, expected }) => {
      const onChange = vi.fn()
      await render(
        createElement(CustomSettingField, {
          integrationId: "site",
          schema,
          effectiveValue: value,
          onChange,
        })
      )
      if (schema.type === "boolean") await click(`#site-custom-${schema.id}`)
      else await enter(`#site-custom-${schema.id}`, String(expected))
      expect(onChange).toHaveBeenCalledWith(expected)
    }
  )

  it("selects a custom option through its labeled control", async () => {
    const schema = customSchemas[3]!
    const onChange = vi.fn()
    await render(
      createElement(CustomSettingField, {
        integrationId: "site",
        schema,
        effectiveValue: "a",
        onChange,
      })
    )
    await select("#site-custom-select", "B")
    expect(onChange).toHaveBeenCalledWith("b")
  })

  it("adds and removes selected values while retaining the other selections", async () => {
    const schema = customSchemas[4]!
    const onChange = vi.fn()
    const props = { integrationId: "site", schema, onChange }
    await render(
      createElement(CustomSettingField, { ...props, effectiveValue: ["en"] })
    )
    await act(async () =>
      container
        .querySelectorAll<HTMLElement>('fieldset [role="checkbox"]')[0]!
        .click()
    )
    expect(onChange).toHaveBeenLastCalledWith([])
    await act(async () =>
      container
        .querySelectorAll<HTMLElement>('fieldset [role="checkbox"]')[1]!
        .click()
    )
    expect(onChange).toHaveBeenLastCalledWith(["en", "ja"])
  })
})

function cardProps(
  overrides: Partial<ComponentProps<typeof SiteIntegrationCard>> = {}
): ComponentProps<typeof SiteIntegrationCard> {
  return {
    siteIntegration: {
      id: "site",
      name: "Site",
      domains: ["site.example"],
      customSettings: customSchemas,
    },
    isEnabled: true,
    globalDefaults: {
      outputFormat: "cbz",
      imagePolicy: { concurrency: 2, delayMs: 500 },
      chapterPolicy: { concurrency: 1, delayMs: 500 },
    },
    onChange: vi.fn(),
    ...overrides,
  }
}

async function openCard(props: ComponentProps<typeof SiteIntegrationCard>) {
  await render(createElement(SiteIntegrationCard, props))
  const selector = `[data-testid="configure-site-integration-${props.siteIntegration.id}"]`
  if (
    container.querySelector(selector)!.getAttribute("aria-expanded") === "false"
  ) {
    await click(selector)
  }
}

const mangadex = getSiteIntegrationList({
  search: "",
  filter: "all",
  enablement: { mangadex: true },
  overriddenIds: new Set(),
}).integrations.find((integration) => integration.id === "mangadex")!

describe("integration overrides", () => {
  it("identifies which shared settings are overridden and which use defaults", async () => {
    await openCard(
      cardProps({
        override: { retries: { image: 0 }, pathTemplate: "Custom" },
      })
    )
    expect(source("site-image-retries")).toContain("options_override")
    expect(source("site-chapter-retries")).toContain("options_globalDefault")
    expect(source("site-path")).toContain("options_override")
    expect(source("site-format")).toContain("options_globalDefault")
  })

  it("allows MangaDex settings to be edited without enabling an override", async () => {
    await openCard(cardProps({ siteIntegration: mangadex }))
    const quality = container.querySelector<HTMLButtonElement>(
      "#mangadex-custom-imageQuality"
    )!
    expect(quality.disabled).toBe(false)
    expect(container.textContent).not.toContain("options_enableOverride")
  })

  it("labels and displays the stored MangaDex quality before saving another allowed option", async () => {
    const quality = mangadex.customSettings!.find(
      (field) => field.id === "imageQuality"
    )!
    if (quality.type !== "select")
      throw new Error("MangaDex image quality requires a select control")
    const original = quality.options.find((option) => option.value === "data")!
    const saver = quality.options.find(
      (option) => option.value === "data-saver"
    )!
    const onSiteIntegrationSettingsChange = vi.fn()
    const props = cardProps({
      siteIntegration: mangadex,
      siteIntegrationSettingsValues: { imageQuality: "data" },
      onSiteIntegrationSettingsChange,
    })
    await openCard(props)
    const control = container.querySelector<HTMLButtonElement>(
      "#mangadex-custom-imageQuality"
    )!
    const label = container.querySelector<HTMLLabelElement>(
      'label[for="mangadex-custom-imageQuality"]'
    )
    expect(label?.control).toBe(control)
    expect(control.disabled).toBe(false)
    expect(control.textContent).toBe(original.labelKey)
    await select("#mangadex-custom-imageQuality", saver.labelKey)
    expect(onSiteIntegrationSettingsChange).toHaveBeenCalledExactlyOnceWith(
      "mangadex",
      "imageQuality",
      "data-saver"
    )
    await openCard({
      ...props,
      siteIntegrationSettingsValues: { imageQuality: "data-saver" },
    })
    expect(control.textContent).toBe(saver.labelKey)
  })

  it("edits image and chapter rate overrides with the enabled default", async () => {
    const props = cardProps({
      siteIntegration: mangadex,
      override: {
        imagePolicy: { concurrency: 3 },
        chapterPolicy: { delayMs: 200 },
      },
    })
    await openCard(props)
    expect(
      container.querySelector<HTMLInputElement>("#mangadex-image-concurrency")!
        .disabled
    ).toBe(false)
    expect(
      container.querySelector<HTMLInputElement>("#mangadex-chapter-delay")!
        .disabled
    ).toBe(false)
    await enter("#mangadex-image-concurrency", "4")
    const edited = {
      imagePolicy: { concurrency: 4 },
      chapterPolicy: { delayMs: 200 },
    }
    expect(props.onChange).toHaveBeenLastCalledWith("mangadex", edited)
    await openCard({ ...props, override: edited })
    await enter("#mangadex-chapter-delay", "0")
    expect(props.onChange).toHaveBeenLastCalledWith("mangadex", {
      imagePolicy: { concurrency: 4 },
      chapterPolicy: { delayMs: 0 },
    })
  })

  it("displays saved zero retries and preserves the sibling when one override is cleared", async () => {
    const props = cardProps({
      siteIntegration: mangadex,
      override: { outputFormat: "zip", retries: { image: 0, chapter: 0 } },
    })
    await openCard(props)
    expect(
      container.querySelector<HTMLInputElement>("#mangadex-image-retries")!
        .value
    ).toBe("0")
    expect(
      container.querySelector<HTMLInputElement>("#mangadex-chapter-retries")!
        .value
    ).toBe("0")
    await enter("#mangadex-image-retries", "")
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith("mangadex", {
      outputFormat: "zip",
      retries: { chapter: 0 },
    })
  })

  it("persists a zero image retry override while preserving the chapter override", async () => {
    const props = cardProps({
      siteIntegration: mangadex,
      override: { retries: { image: 1, chapter: 2 } },
    })
    await openCard(props)
    await enter("#mangadex-image-retries", "0")
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith("mangadex", {
      retries: { image: 0, chapter: 2 },
    })
  })

  it("resets a single policy override", async () => {
    const props = cardProps({
      siteIntegration: mangadex,
      override: { outputFormat: "zip" },
    })
    await openCard(props)
    await click('[data-testid="reset-site-integration-overrides-mangadex"]')
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith("mangadex", null)
    expect(
      container
        .querySelector('[data-testid="configure-site-integration-mangadex"]')!
        .getAttribute("aria-expanded")
    ).toBe("false")
  })

  it("clears a path override and preserves unrelated values", async () => {
    const props = cardProps({
      override: { outputFormat: "zip", pathTemplate: "Old" },
    })
    await openCard(props)
    await enter("#site-path", "")
    expect(props.onChange).toHaveBeenLastCalledWith("site", {
      outputFormat: "zip",
    })
    await openCard(
      cardProps({ override: { pathTemplate: "Old" }, onChange: props.onChange })
    )
    await enter("#site-path", "")
    expect(props.onChange).toHaveBeenLastCalledWith("site", null)
  })

  it("normalizes rate edits while keeping chapter concurrency inherited", async () => {
    const props = cardProps({
      override: {
        imagePolicy: { concurrency: 3 },
        chapterPolicy: { delayMs: 20 },
      },
    })
    await openCard(props)
    await enter("#site-image-concurrency", "")
    expect(props.onChange).toHaveBeenLastCalledWith("site", {
      chapterPolicy: { delayMs: 20 },
    })
    await enter("#site-chapter-delay", "0")
    expect(props.onChange).toHaveBeenLastCalledWith("site", {
      imagePolicy: { concurrency: 3 },
      chapterPolicy: { delayMs: 0 },
    })
    expect(container.querySelector("#site-chapter-concurrency")).toBeNull()
  })

  it("retains zero retries and removes only the cleared retry", async () => {
    const props = cardProps({ override: { retries: { image: 2, chapter: 3 } } })
    await openCard(props)
    await enter("#site-image-retries", "0")
    expect(props.onChange).toHaveBeenLastCalledWith("site", {
      retries: { image: 0, chapter: 3 },
    })
    await enter("#site-chapter-retries", "")
    expect(props.onChange).toHaveBeenLastCalledWith("site", {
      retries: { image: 2 },
    })
  })

  it("removes a format override when selecting the global format", async () => {
    const props = cardProps({ override: { outputFormat: "zip" } })
    await openCard(props)
    await select("#site-format", "options_cbzFull")
    expect(props.onChange).toHaveBeenLastCalledWith("site", null)
  })

  it("resets only the selected custom setting and clears shared overrides independently", async () => {
    const onSiteIntegrationSettingsChange = vi.fn()
    const props = cardProps({
      override: { outputFormat: "zip" },
      siteIntegrationSettingsValues: { bool: false, number: 0 },
      onSiteIntegrationSettingsChange,
    })
    await openCard(props)
    const resetCustom = container.querySelector<HTMLButtonElement>(
      'button[aria-describedby="site-custom-bool-label"]'
    )!
    await act(async () => resetCustom.click())
    expect(onSiteIntegrationSettingsChange).toHaveBeenCalledExactlyOnceWith(
      "site",
      "bool",
      undefined
    )
    expect(props.onChange).not.toHaveBeenCalled()

    onSiteIntegrationSettingsChange.mockClear()
    await click('[data-testid="reset-site-integration-overrides-site"]')
    expect(props.onChange).toHaveBeenCalledWith("site", null)
    expect(onSiteIntegrationSettingsChange).not.toHaveBeenCalled()
  })

  it("supports absent optional callbacks and sends integration identity when enabled", async () => {
    const props = cardProps({
      siteIntegrationSettingsValues: { text: "saved" },
    })
    await openCard(props)
    await enter("#site-custom-text", "changed")
    await click("#site-integration-enabled")
    expect(
      container.querySelector(
        '[data-testid="reset-site-integration-overrides-site"]'
      )
    ).toBeNull()
    const onEnabledChange = vi.fn()
    await render(
      createElement(SiteIntegrationCard, { ...props, onEnabledChange })
    )
    await click("#site-integration-enabled")
    expect(onEnabledChange).toHaveBeenCalledWith("site", false)
  })
})

describe("download output presentation", () => {
  it("selects a real archive radio and displays the loose-file warning", async () => {
    const onValueChange = vi.fn()
    await render(
      createElement(ArchiveFormatPicker, {
        value: "cbz",
        showNoArchiveWarning: true,
        onValueChange,
      })
    )
    await click("#format-none")
    expect(onValueChange).toHaveBeenCalledWith("none")
    expect(container.textContent).toContain("options_noArchiveWarningTitle")
  })

  it("previews valid templates and announces directory or filename errors", async () => {
    await render(
      createElement(PathVisualization, {
        fileOptions: DEFAULT_SETTINGS.downloads,
        template: "Series",
        filenameTemplate: "Chapter",
        format: "cbz",
      })
    )
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Series/Chapter.cbz"
    )
    await render(
      createElement(PathVisualization, {
        fileOptions: DEFAULT_SETTINGS.downloads,
        template: "<UNKNOWN>",
        filenameTemplate: "Chapter",
        format: "zip",
      })
    )
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "UNKNOWN"
    )
    await render(
      createElement(PathVisualization, {
        fileOptions: DEFAULT_SETTINGS.downloads,
        template: "Series",
        filenameTemplate: "",
        format: "none",
      })
    )
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).not.toContain("Series/")
  })
})
