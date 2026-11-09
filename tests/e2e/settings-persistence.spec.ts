import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures/extension"
import { OptionsPageObject } from "./pages/options"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { getGlobalState } from "./fixtures/state-helpers"

let optionsPage: Page
let options: OptionsPageObject

const SETTINGS_STORAGE_KEY = "settings:global"
const DOWNLOAD_ROOT_DB_NAME = "tako-fs"
const DOWNLOAD_ROOT_DB_VERSION = 2
const MANAGED_DOWNLOAD_ROOT_STORE_NAME = "managed-handles"
const DOWNLOAD_ROOT_STORE_NAME = "handles"
const DOWNLOAD_ROOT_HANDLE_ID = "download-root"

async function seedCustomDirectoryHandle(page: Page): Promise<string> {
  return await page.evaluate(
    async ({ dbName, dbVersion, storeName, managedStoreName, handleId }) => {
      const directoryName = `settings-persistence-${Date.now()}`
      const opfsRoot = await navigator.storage.getDirectory()
      const seededDirectory = await opfsRoot.getDirectoryHandle(directoryName, {
        create: true,
      })

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName)
          }
          if (!db.objectStoreNames.contains(managedStoreName)) {
            db.createObjectStore(managedStoreName)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(
            request.error ?? new Error("Failed to open custom-folder IndexedDB")
          )
      })

      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(storeName, "readwrite")
          const store = transaction.objectStore(storeName)
          store.put(seededDirectory, handleId)
          transaction.oncomplete = () => resolve()
          transaction.onabort = transaction.onerror = () =>
            reject(
              transaction.error ??
                new Error("Failed to seed persisted folder handle")
            )
        })
      } finally {
        database.close()
      }

      return directoryName
    },
    {
      dbName: DOWNLOAD_ROOT_DB_NAME,
      dbVersion: DOWNLOAD_ROOT_DB_VERSION,
      managedStoreName: MANAGED_DOWNLOAD_ROOT_STORE_NAME,
      storeName: DOWNLOAD_ROOT_STORE_NAME,
      handleId: DOWNLOAD_ROOT_HANDLE_ID,
    }
  )
}

async function readPersistedDirectoryName(page: Page): Promise<string | null> {
  return await page.evaluate(
    async ({ dbName, dbVersion, storeName, managedStoreName }) => {
      const stored = await chrome.storage.local.get("settings:global")
      const handleId = (
        stored["settings:global"] as {
          downloads: { customDirectoryHandleId: string | null }
        }
      ).downloads.customDirectoryHandleId
      if (handleId === null) return null
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName)
          }
          if (!db.objectStoreNames.contains(managedStoreName)) {
            db.createObjectStore(managedStoreName)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(
            request.error ?? new Error("Failed to open custom-folder IndexedDB")
          )
      })

      try {
        const handle = await new Promise<FileSystemDirectoryHandle | undefined>(
          (resolve, reject) => {
            const transaction = database.transaction(storeName, "readonly")
            const request = transaction.objectStore(storeName).get(handleId)
            request.onsuccess = () =>
              resolve(request.result as FileSystemDirectoryHandle | undefined)
            request.onerror = () =>
              reject(
                request.error ??
                  new Error("Failed to read persisted folder handle")
              )
          }
        )
        return handle?.name ?? null
      } finally {
        database.close()
      }
    },
    {
      dbName: DOWNLOAD_ROOT_DB_NAME,
      dbVersion: DOWNLOAD_ROOT_DB_VERSION,
      managedStoreName: MANAGED_DOWNLOAD_ROOT_STORE_NAME,
      storeName: DOWNLOAD_ROOT_STORE_NAME,
      handleId: DOWNLOAD_ROOT_HANDLE_ID,
    }
  )
}

test.describe("Settings persistence", () => {
  test.beforeEach(async ({ page, extensionId }) => {
    optionsPage = page
    options = new OptionsPageObject(page, extensionId)
  })

  test.describe("Archive format", () => {
    test("defaults to CBZ", async () => {
      await options.navigate()

      const format = await options.getArchiveFormat()
      expect(format).toBe("cbz")
    })

    test("persists changes from CBZ to ZIP and back", async () => {
      await options.navigate()

      // Change to zip
      await options.setArchiveFormat("zip")
      await options.saveSettings()

      // Reload page and verify persistence
      await options.navigate()

      const format = await options.getArchiveFormat()
      expect(format).toBe("zip")

      await options.setArchiveFormat("cbz")
      await options.saveSettings()
      await options.navigate()
      expect(await options.getArchiveFormat()).toBe("cbz")
    })

    test("persists loose-image format", async () => {
      await options.navigate()

      // Change to none
      await options.setArchiveFormat("none")
      await options.saveSettings()

      // Reload and verify
      await options.navigate()

      const format = await options.getArchiveFormat()
      expect(format).toBe("none")
    })
  })

  test.describe("ComicInfo", () => {
    test("persists the ComicInfo setting", async () => {
      await options.navigate()

      // Get initial state
      const initialState = await options.isComicInfoEnabled()

      // Toggle
      await options.toggleComicInfo()
      await options.saveSettings()

      // Reload and verify
      await options.navigate()

      const newState = await options.isComicInfoEnabled()
      expect(newState).toBe(!initialState)
    })
  })

  test.describe("Image normalization", () => {
    test("persists image filename normalization", async () => {
      await options.navigate()

      const initialState = await options.isImageNormalizationEnabled()

      await options.toggleImageNormalization()
      await options.saveSettings()

      await options.navigate()

      const newState = await options.isImageNormalizationEnabled()
      expect(newState).toBe(!initialState)
    })
  })

  test.describe("Download destination", () => {
    test("persists the download path template", async () => {
      await options.navigate()

      const customPath = "CustomFolder/<SERIES_TITLE>/<CHAPTER_TITLE>"
      await options.setDirectoryTemplate(customPath)
      await options.saveSettings()

      await options.navigate()

      const savedPath = await options.getDirectoryTemplate()
      expect(savedPath).toBe(customPath)
    })

    test("keeps the saved folder when a destination change is discarded", async () => {
      await options.navigate()

      const directoryName = await seedCustomDirectoryHandle(optionsPage)
      await optionsPage.evaluate(
        async ({ storageKey, settings }) => {
          await chrome.storage.local.set({ [storageKey]: settings })
        },
        {
          storageKey: SETTINGS_STORAGE_KEY,
          settings: {
            ...DEFAULT_SETTINGS,
            uiLanguage: "en",
            downloads: {
              ...DEFAULT_SETTINGS.downloads,
              destination: "file-system-access",
              customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
            },
          },
        }
      )

      await options.navigate()
      await options.switchToSection("storage")

      await expect(
        optionsPage.getByText(`Current folder: ${directoryName}`)
      ).toBeVisible()

      await optionsPage
        .getByRole("button", { name: "Use browser downloads" })
        .click()
      await optionsPage.getByRole("button", { name: "Discard" }).click()
      await optionsPage.getByRole("button", { name: "Discard Changes" }).click()

      await options.navigate()
      await options.switchToSection("storage")

      await expect(
        optionsPage.getByText(`Current folder: ${directoryName}`)
      ).toBeVisible()
      await expect
        .poll(() => readPersistedDirectoryName(optionsPage))
        .toBe(directoryName)
    })

    test("clears the saved folder when browser downloads are selected", async () => {
      await options.navigate()

      const directoryName = await seedCustomDirectoryHandle(optionsPage)
      await optionsPage.evaluate(
        async ({ storageKey, settings }) => {
          await chrome.storage.local.set({ [storageKey]: settings })
        },
        {
          storageKey: SETTINGS_STORAGE_KEY,
          settings: {
            ...DEFAULT_SETTINGS,
            uiLanguage: "en",
            downloads: {
              ...DEFAULT_SETTINGS.downloads,
              destination: "file-system-access",
              customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
            },
          },
        }
      )

      await options.navigate()
      await options.switchToSection("storage")

      await expect(
        optionsPage.getByText(`Current folder: ${directoryName}`)
      ).toBeVisible()

      await optionsPage
        .getByRole("button", { name: "Use browser downloads" })
        .click()
      await options.saveSettings()
      await options.waitForSaveSuccess()

      await options.navigate()
      await options.switchToSection("storage")

      await expect(
        optionsPage.getByText(`Current folder: ${directoryName}`)
      ).toHaveCount(0)
      await expect
        .poll(() => readPersistedDirectoryName(optionsPage))
        .toBeNull()
    })
    test("requires a folder before saving a custom destination", async () => {
      await options.navigate()
      await options.switchToSection("storage")

      const switchLocator = optionsPage.locator("#custom-folder-switch")
      await expect(switchLocator).toHaveAttribute("aria-checked", "false")
      await expect(
        optionsPage.getByText(
          "No custom folder selected. Uses default browser downloads."
        )
      ).toBeVisible()
      await expect(
        optionsPage.getByText("No download folder selected")
      ).toHaveCount(0)

      // Toggle custom folder switch ON without picking a folder
      await switchLocator.click()
      await expect(switchLocator).toHaveAttribute("aria-checked", "true")
      await expect(optionsPage.getByText("No folder selected.")).toBeVisible()
      await expect(
        optionsPage.getByText("No download folder selected")
      ).toBeVisible()
      await expect(
        optionsPage.getByText("Choose a folder before saving these settings.")
      ).toBeVisible()

      // Attempt to save changes
      const saveButton = optionsPage.getByRole("button", {
        name: "Save Changes",
      })
      await expect(saveButton).toBeVisible()
      await saveButton.click()

      // Assert clear error toast is displayed (not unknown error)
      await expect(
        optionsPage.getByText("Failed to save settings")
      ).toBeVisible()
      await expect(
        optionsPage.getByText(
          "Custom download mode requires a folder. Please select one first."
        )
      ).toBeVisible()

      // Destination in storage must NOT have been saved as file-system-access
      const storedSettings = await optionsPage.evaluate(async (storageKey) => {
        const res = (await chrome.storage.local.get(storageKey)) as Record<
          string,
          { downloads?: { destination?: string } }
        >
        return res[storageKey]?.downloads?.destination ?? null
      }, SETTINGS_STORAGE_KEY)
      expect(storedSettings).not.toBe("file-system-access")
    })

    test("shows the saved folder name when it remains available", async () => {
      await options.navigate()

      const directoryName = await seedCustomDirectoryHandle(optionsPage)
      await optionsPage.evaluate(
        async ({ storageKey, settings }) => {
          await chrome.storage.local.set({ [storageKey]: settings })
        },
        {
          storageKey: SETTINGS_STORAGE_KEY,
          settings: {
            ...DEFAULT_SETTINGS,
            uiLanguage: "en",
            downloads: {
              ...DEFAULT_SETTINGS.downloads,
              destination: "file-system-access",
              customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
            },
          },
        }
      )

      await options.navigate()
      await options.switchToSection("storage")

      const switchLocator = optionsPage.locator("#custom-folder-switch")
      await expect(switchLocator).toHaveAttribute("aria-checked", "true")
      await expect(
        optionsPage.getByText(`Current folder: ${directoryName}`)
      ).toBeVisible()
      await expect(
        optionsPage.getByText("No download folder selected")
      ).toHaveCount(0)
      await switchLocator.click()
      await switchLocator.click()
      await options.saveSettings()
      await options.waitForSaveSuccess()
      await expect(
        optionsPage.getByText(`Current folder: ${directoryName}`)
      ).toBeVisible()
      expect(await readPersistedDirectoryName(optionsPage)).toBe(directoryName)
    })

    test("explains a save failure when the chosen folder was deleted", async () => {
      await options.navigate()

      const directoryName = await seedCustomDirectoryHandle(optionsPage)
      await optionsPage.evaluate(
        async ({ storageKey, settings }) => {
          await chrome.storage.local.set({ [storageKey]: settings })
        },
        {
          storageKey: SETTINGS_STORAGE_KEY,
          settings: {
            ...DEFAULT_SETTINGS,
            uiLanguage: "en",
            downloads: {
              ...DEFAULT_SETTINGS.downloads,
              destination: "file-system-access",
              customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
            },
          },
        }
      )

      // Delete the underlying directory from OPFS while keeping the handle in IndexedDB
      await optionsPage.evaluate(async (dirName) => {
        const opfsRoot = await navigator.storage.getDirectory()
        await opfsRoot.removeEntry(dirName, { recursive: true })
      }, directoryName)

      await options.navigate()

      // Modify another setting to trigger unsaved changes and attempt to save
      await options.setFileNameTemplate("DeletedFolderTestTemplate")
      const saveButton = optionsPage.getByRole("button", {
        name: "Save Changes",
      })
      await expect(saveButton).toBeVisible()
      await saveButton.click()

      // Assert save fails with the specific deleted folder error
      await expect(
        optionsPage.getByText("Failed to save settings")
      ).toBeVisible()
      await expect(
        optionsPage.getByText(
          "The selected download folder does not exist or was deleted. Please select a valid folder."
        )
      ).toBeVisible()
    })
  })

  test.describe("Filename template", () => {
    test("persists the filename template", async () => {
      await options.navigate()

      const customTemplate = "<SERIES_TITLE> - Chapter <CHAPTER_NUMBER>"
      await options.setFileNameTemplate(customTemplate)
      await options.saveSettings()

      await options.navigate()

      const savedTemplate = await options.getFileNameTemplate()
      expect(savedTemplate).toBe(customTemplate)
    })
  })

  test.describe("Notifications", () => {
    test("persists the notification setting", async () => {
      await options.navigate()

      const initialState = await options.areNotificationsEnabled()

      await options.toggleNotifications()
      await options.saveSettings()

      await options.navigate()

      const newState = await options.areNotificationsEnabled()
      expect(newState).toBe(!initialState)
    })
  })

  test.describe("Background settings", () => {
    test("synchronizes the saved format to background state", async ({
      context,
    }) => {
      await options.navigate()

      // Set zip format
      await options.setArchiveFormat("zip")
      await options.saveSettings()

      await expect
        .poll(async () => {
          const state = await getGlobalState(context)
          return state?.settings.downloads.defaultFormat
        })
        .toBe("zip")
    })
  })
})

test.describe("Settings across pages", () => {
  test("shares the saved format with another Options page", async ({
    context,
    extensionId,
  }) => {
    // Open first options page and set format
    const page1 = await context.newPage()
    const opts1 = new OptionsPageObject(page1, extensionId)
    await opts1.navigate()

    await opts1.setArchiveFormat("zip")
    await opts1.saveSettings()

    // Open second options page and verify
    const page2 = await context.newPage()
    const opts2 = new OptionsPageObject(page2, extensionId)
    await opts2.navigate()

    const format = await opts2.getArchiveFormat()
    expect(format).toBe("zip")

    await page1.close()
    await page2.close()
  })
})

test.describe("Destination saves across Options closure", () => {
  for (const boundary of ["before-commit", "after-commit"] as const) {
    test(`recovers the matching saved folder ${boundary}`, async ({
      page,
      context,
      extensionId,
    }) => {
      const initialOptions = new OptionsPageObject(page, extensionId)
      await initialOptions.navigate()
      const oldName = await seedCustomDirectoryHandle(page)
      await page.evaluate(
        async (settings) => {
          await chrome.storage.local.set({ "settings:global": settings })
        },
        {
          ...DEFAULT_SETTINGS,
          uiLanguage: "en",
          downloads: {
            ...DEFAULT_SETTINGS.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
          },
        }
      )
      await initialOptions.navigate()
      await initialOptions.switchToSection("storage")
      await expect(page.getByText(`Current folder: ${oldName}`)).toBeVisible()
      const newName = await page.evaluate(async (boundary) => {
        const name = `new-folder-${crypto.randomUUID()}`
        const root = await navigator.storage.getDirectory()
        const handle = await root.getDirectoryHandle(name, { create: true })
        Object.defineProperty(window, "showDirectoryPicker", {
          configurable: true,
          value: async () => handle,
        })
        const send = chrome.runtime.sendMessage.bind(chrome.runtime)
        chrome.runtime.sendMessage = ((message: {
          type?: string
          payload?: { configuration?: unknown }
        }) => {
          if (message.type !== "SAVE_OPTIONS_CONFIGURATION")
            return send(message)
          Object.assign(window, {
            submittedConfiguration: message.payload?.configuration,
          })
          if (boundary === "before-commit") return new Promise(() => {})
          return send(message).then(() => new Promise(() => {}))
        }) as typeof chrome.runtime.sendMessage
        return name
      }, boundary)
      await page.getByRole("button", { name: "Change folder" }).click()
      await expect(page.getByText(`Current folder: ${newName}`)).toBeVisible()
      await page.getByRole("button", { name: "Save Changes" }).click()
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              (window as unknown as { submittedConfiguration?: unknown })
                .submittedConfiguration
            )
          )
        )
        .toBe(true)

      const observer = await context.newPage()
      const reopened = new OptionsPageObject(observer, extensionId)
      await reopened.navigate()
      const expectedName = boundary === "before-commit" ? oldName : newName
      await expect
        .poll(() => readPersistedDirectoryName(observer))
        .toBe(expectedName)
      await page.close()

      const session = await context.newCDPSession(observer)
      const { targetInfos } = await session.send("Target.getTargets")
      const worker = targetInfos.find(
        (target) =>
          target.type === "service_worker" &&
          target.url === `chrome-extension://${extensionId}/background.js`
      )
      expect(worker).toBeDefined()
      await session.send("Target.closeTarget", { targetId: worker!.targetId })
      await session.detach()

      await reopened.navigate()
      await reopened.switchToSection("storage")
      await expect(
        observer.getByText(`Current folder: ${expectedName}`)
      ).toBeVisible()
      expect(await readPersistedDirectoryName(observer)).toBe(expectedName)
    })
  }
})
