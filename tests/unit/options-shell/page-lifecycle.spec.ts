// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { OptionsSidebar } from "@/entrypoints/options/components/OptionsSidebar"
import {
  useOptionsNavigation,
  useOptionsSaveShortcut,
  useOptionsUnloadGuard,
} from "@/entrypoints/options/main-options-lifecycle"
import { t } from "@/src/runtime/i18n"

let root: Root
let container: HTMLDivElement
const saveConfiguration = vi.fn(async () => {})
const initialState = {
  hasUnsavedChanges: true,
  isSaving: false,
  hasExternalChanges: false,
  saveConfiguration,
}

function Harness({ state = initialState }) {
  const navigation = useOptionsNavigation()
  useOptionsSaveShortcut(state)
  useOptionsUnloadGuard(state.hasUnsavedChanges)
  return createElement(OptionsSidebar, {
    activeSection: navigation.activeSection,
    onSectionChange: navigation.handleSectionChange,
  })
}

function shortcut(options: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    key: "s",
    cancelable: true,
    ...options,
  })
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("chrome", {
    ...chrome,
    runtime: { getManifest: () => ({ version: "2.0.9" }) },
  })
  window.history.replaceState(null, "", "?tab=STORAGE&source=fixture#current")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it("tracks direct links, navigation and browser history without duplicate entries", async () => {
  const push = vi.spyOn(window.history, "pushState")
  await act(async () => root.render(createElement(Harness)))
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
    t("options_storage")
  )
  const network = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === t("options_network")
  )!
  await act(async () => network.click())
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
    t("options_network")
  )
  expect(new URL(window.location.href).searchParams.get("source")).toBe(
    "fixture"
  )
  expect(window.location.hash).toBe("#current")
  await act(async () => network.click())
  expect(push).toHaveBeenCalledOnce()
  window.history.replaceState(null, "", "?tab=activity")
  await act(async () => window.dispatchEvent(new PopStateEvent("popstate")))
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
    t("options_activity")
  )
  window.history.replaceState(null, "", "?tab=invalid")
  await act(async () => window.dispatchEvent(new PopStateEvent("popstate")))
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
    t("options_general")
  )
  expect(push).toHaveBeenCalledOnce()
})

it.each([
  {
    hasUnsavedChanges: true,
    isSaving: false,
    hasExternalChanges: false,
    expected: 1,
  },
  {
    hasUnsavedChanges: false,
    isSaving: false,
    hasExternalChanges: false,
    expected: 0,
  },
  {
    hasUnsavedChanges: true,
    isSaving: true,
    hasExternalChanges: false,
    expected: 0,
  },
  {
    hasUnsavedChanges: true,
    isSaving: false,
    hasExternalChanges: true,
    expected: 0,
  },
])("uses the current save eligibility %#", async ({ expected, ...state }) => {
  await act(async () =>
    root.render(
      createElement(Harness, { state: { ...state, saveConfiguration } })
    )
  )
  expect(shortcut({ ctrlKey: true }).defaultPrevented).toBe(true)
  expect(saveConfiguration).toHaveBeenCalledTimes(expected)
  expect(shortcut({ metaKey: true }).defaultPrevented).toBe(true)
  expect(saveConfiguration).toHaveBeenCalledTimes(expected * 2)
  expect(shortcut({}).defaultPrevented).toBe(false)
  expect(shortcut({ ctrlKey: true, key: "x" }).defaultPrevented).toBe(false)
})

it("updates the unload guard and removes window listeners when the page closes", async () => {
  const add = vi.spyOn(window, "addEventListener")
  const remove = vi.spyOn(window, "removeEventListener")
  await act(async () => root.render(createElement(Harness)))
  const dirty = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(dirty)
  expect(dirty.defaultPrevented).toBe(true)
  await act(async () =>
    root.render(
      createElement(Harness, {
        state: { ...initialState, hasUnsavedChanges: false },
      })
    )
  )
  const clean = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
  await act(async () => root.unmount())
  for (const [type, listener] of add.mock.calls.filter(([type]) =>
    ["keydown", "popstate", "beforeunload"].includes(type)
  )) {
    expect(
      remove.mock.calls.some(
        ([removedType, removedListener]) =>
          removedType === type && removedListener === listener
      )
    ).toBe(true)
  }
  expect(shortcut({ ctrlKey: true }).defaultPrevented).toBe(false)
  expect(saveConfiguration).not.toHaveBeenCalled()
})
