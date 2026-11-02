// @vitest-environment happy-dom

import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NetworkTab } from "@/entrypoints/options/tabs/NetworkTab"
import { StorageTab } from "@/entrypoints/options/tabs/StorageTab"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { ExtensionSettingsSchema } from "@/src/domain/settings/schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"

let root: Root
let container: HTMLDivElement
const onChange = vi.fn<(updates: Partial<ExtensionSettings>) => void>()

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  onChange.mockReset()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function renderTab(
  tab: "network" | "storage",
  initial = DEFAULT_SETTINGS
) {
  function View() {
    const [settings, setSettings] = useState(initial)
    const update = (updates: Partial<ExtensionSettings>) => {
      onChange(updates)
      setSettings((current) => ({ ...current, ...updates }))
    }
    return tab === "network"
      ? createElement(NetworkTab, { settings, onChange: update })
      : createElement(StorageTab, {
          settings,
          onChange: update,
          selectedFolderName: null,
          folderAccessRequired: false,
          onGrantFolderAccess: async () => true,
          onPickFolder: async () => {},
          isPickingFolder: false,
          isSaving: false,
        })
  }
  await act(async () => root.render(createElement(View)))
}

async function enter(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function choose(selector: string, label: string) {
  const trigger = container.querySelector<HTMLElement>(selector)!
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
  )
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]')
  ).find((candidate) => candidate.textContent === label)
  expect(option).toBeDefined()
  await act(async () => option!.click())
}

it("changes image concurrency in integral steps through the slider keyboard", async () => {
  await renderTab("network")
  const slider = container.querySelector<HTMLElement>('[role="slider"]')!
  await act(async () => {
    slider.focus()
    slider.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    )
  })
  expect(slider.getAttribute("aria-valuenow")).toBe("3")
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      image: { concurrency: 3, delayMs: 500 },
      chapter: DEFAULT_SETTINGS.globalPolicy.chapter,
    },
  })
  await act(async () =>
    slider.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
    )
  )
  expect(slider.getAttribute("aria-valuenow")).toBe("2")
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: DEFAULT_SETTINGS.globalPolicy,
  })
})

it("applies zero-delay presets while preserving the other policy fields", async () => {
  await renderTab("network")
  const buttons = Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent === "0ms"
  )
  await act(async () => buttons[0]!.click())
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      image: { concurrency: 2, delayMs: 0 },
      chapter: DEFAULT_SETTINGS.globalPolicy.chapter,
    },
  })
  expect(
    container.querySelector<HTMLInputElement>("#image-request-delay")!.value
  ).toBe("0")
  await act(async () => buttons[1]!.click())
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      image: { concurrency: 2, delayMs: 0 },
      chapter: { concurrency: 1, delayMs: 0 },
    },
  })
  expect(
    container.querySelector<HTMLInputElement>("#chapter-delay")!.value
  ).toBe("0")
})

it.each([
  { scope: "image", expected: { image: 0, chapter: 3 } },
  { scope: "chapter", expected: { image: 3, chapter: 0 } },
])(
  "persists zero global %s retries while preserving the sibling",
  async ({ scope, expected }) => {
    await renderTab("network")
    await enter(`#${scope}-retries`, "0")
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      globalRetries: expected,
    })
    expect(
      container.querySelector<HTMLInputElement>(`#${scope}-retries`)!.value
    ).toBe("0")
  }
)

it("saves archive and numeric or automatic padding choices as valid download settings", async () => {
  await renderTab("storage")
  await act(async () =>
    container.querySelector<HTMLElement>("#format-zip")!.click()
  )
  expect(
    container.querySelector("#format-zip")!.getAttribute("aria-checked")
  ).toBe("true")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: { ...DEFAULT_SETTINGS.downloads, defaultFormat: "zip" },
  })
  await choose("#image-padding", t("options_padding4"))
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      defaultFormat: "zip",
      imagePaddingDigits: 4,
    },
  })
  expect(
    ExtensionSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...onChange.mock.lastCall![0],
    }).success
  ).toBe(true)
  await choose("#image-padding", t("options_paddingAuto"))
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: {
      ...DEFAULT_SETTINGS.downloads,
      defaultFormat: "zip",
      imagePaddingDigits: "auto",
    },
  })
  expect(
    ExtensionSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...onChange.mock.lastCall![0],
    }).success
  ).toBe(true)
})
