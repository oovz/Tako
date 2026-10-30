// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { StorageTab } from "@/entrypoints/options/tabs/StorageTab"
import { NetworkTab } from "@/entrypoints/options/tabs/NetworkTab"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"

let root: Root
let container: HTMLDivElement
const onChange = vi.fn()

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function mountStorage(
  downloads: Partial<typeof DEFAULT_SETTINGS.downloads> = {}
) {
  const settings = {
    ...DEFAULT_SETTINGS,
    downloads: { ...DEFAULT_SETTINGS.downloads, ...downloads },
  }
  await act(async () =>
    root.render(
      createElement(StorageTab, {
        settings,
        onChange,
        selectedFolderName: null,
        folderAccessRequired: false,
        onGrantFolderAccess: async () => true,
        onPickFolder: async () => {},
        isPickingFolder: false,
        isSaving: false,
      })
    )
  )
  return settings
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

it.each([
  ["", "<SERIES_TITLE>"],
  ["Library", "Library/<SERIES_TITLE>"],
  ["Library/", "Library/<SERIES_TITLE>"],
])(
  "appends directory macros with one separator to %j",
  async (pathTemplate, expected) => {
    const settings = await mountStorage({ pathTemplate })
    const macro = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "+ <SERIES_TITLE>"
    )!
    await act(async () => macro.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      downloads: { ...settings.downloads, pathTemplate: expected },
    })
  }
)

it.each([
  ["", "<CHAPTER_TITLE>"],
  ["Chapter", "Chapter - <CHAPTER_TITLE>"],
])(
  "appends filename macros with the filename separator to %j",
  async (fileNameTemplate, expected) => {
    const settings = await mountStorage({ fileNameTemplate })
    const macro = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "+ <CHAPTER_TITLE>"
    )[1]!
    await act(async () => macro.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      downloads: { ...settings.downloads, fileNameTemplate: expected },
    })
  }
)

it("marks invalid templates and forwards text edits while preserving other download defaults", async () => {
  const settings = await mountStorage({
    pathTemplate: "<UNKNOWN>",
    fileNameTemplate: "<CHAPTER_TITLE",
  })
  expect(
    container.querySelector("#download-path")?.getAttribute("aria-invalid")
  ).toBe("true")
  expect(
    container.querySelector("#filename-template")?.getAttribute("aria-invalid")
  ).toBe("true")
  await enter("#download-path", "Library/<SERIES_TITLE>")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: {
      ...settings.downloads,
      pathTemplate: "Library/<SERIES_TITLE>",
    },
  })
  await enter("#filename-template", "<CHAPTER_NUMBER>")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: { ...settings.downloads, fileNameTemplate: "<CHAPTER_NUMBER>" },
  })
  await enter("#filename-template", "")
  expect(onChange).toHaveBeenLastCalledWith({
    downloads: { ...settings.downloads, fileNameTemplate: "" },
  })
})

it("changes metadata switches without replacing unrelated download settings", async () => {
  const settings = await mountStorage()
  for (const [id, key] of [
    ["comicinfo", "includeComicInfo"],
    ["cover-image", "includeCoverImage"],
    ["normalize", "normalizeImageFilenames"],
  ] as const) {
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`#${id}`)!.click()
    )
    expect(onChange).toHaveBeenLastCalledWith({
      downloads: { ...settings.downloads, [key]: !settings.downloads[key] },
    })
  }
})

it("bounds image and chapter delays independently and retains the other policy fields", async () => {
  await act(async () =>
    root.render(
      createElement(NetworkTab, { settings: DEFAULT_SETTINGS, onChange })
    )
  )
  await enter("#image-request-delay", "-100")
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      ...DEFAULT_SETTINGS.globalPolicy,
      image: {
        ...DEFAULT_SETTINGS.globalPolicy.image,
        delayMs: RATE_POLICY_LIMITS.MIN_DELAY_MS,
      },
    },
  })
  await enter("#chapter-delay", "99999999")
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      ...DEFAULT_SETTINGS.globalPolicy,
      chapter: {
        ...DEFAULT_SETTINGS.globalPolicy.chapter,
        delayMs: RATE_POLICY_LIMITS.MAX_DELAY_MS,
      },
    },
  })
  const zeroPresets = Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent === "0ms"
  )
  await act(async () => zeroPresets[1].click())
  expect(onChange).toHaveBeenLastCalledWith({
    globalPolicy: {
      ...DEFAULT_SETTINGS.globalPolicy,
      chapter: { ...DEFAULT_SETTINGS.globalPolicy.chapter, delayMs: 0 },
    },
  })
  await enter("#image-retries", "")
  expect(onChange).toHaveBeenLastCalledWith({
    globalRetries: { ...DEFAULT_SETTINGS.globalRetries, image: 0 },
  })
  await enter("#chapter-retries", "7")
  expect(onChange).toHaveBeenLastCalledWith({
    globalRetries: { ...DEFAULT_SETTINGS.globalRetries, chapter: 7 },
  })
})
