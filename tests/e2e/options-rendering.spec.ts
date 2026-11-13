import { test, expect } from "./fixtures/extension"

test.describe("Options Page", () => {
  test("opens General settings", async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await page.waitForLoadState("domcontentloaded")

    // Wait for page content to load
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })

    // Verify options page loaded - check for sidebar navigation
    await expect(page.getByText("Tako Settings")).toBeVisible()
    await expect(page.getByRole("button", { name: "General" })).toBeVisible()
  })

  test("displays download format selector", async ({ page, extensionId }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=storage`
    )
    await page.waitForLoadState("domcontentloaded")

    // Wait for page content to load
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })

    // Check for archive format RadioGroup (CBZ/ZIP/None options)
    await expect(
      page.locator('[data-testid="archive-format-radiogroup"]')
    ).toBeVisible()
    await expect(page.getByText("CBZ Archive")).toBeVisible()
    await expect(
      page.locator('[data-testid="suppress-save-as-switch"]')
    ).toBeVisible()
  })

  test("shows the no-archive shelf warning alongside archive format settings", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=storage`
    )
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })

    const output = page.locator("#template-validation-status")
    await expect(output).toContainText(".cbz")
    await page.locator('label[for="format-none"]').click()
    await expect(output).toContainText("Individual image files")
    await expect(output).not.toContainText(".cbz")

    await expect(
      page.getByText(
        "No archive + default downloads can clutter the download shelf"
      )
    ).toBeVisible()

    await page.getByRole("button", { name: "Save Changes" }).click()
    await expect(page.getByText("Unsaved changes")).toHaveCount(0)

    await page.getByRole("button", { name: /Activity/i }).click()
    await expect(
      page.getByText(
        "No archive + default downloads can clutter the download shelf"
      )
    ).toHaveCount(0)
  })

  test("persists chapter delay without exposing chapter concurrency", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=network`
    )
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })

    await expect(
      page.locator('[data-testid="concurrent-chapters-slider"]')
    ).toHaveCount(0)
    const input = page.locator('[data-testid="chapter-delay-input"]')
    await input.fill("1250")
    const preview = page.getByRole("group", {
      name: "Request pattern",
      exact: true,
    })
    await expect(preview).toContainText(/1[,. ]?250 ms/)
    await page.getByTestId("request-delay-input").fill("600")
    await expect(preview.getByRole("listitem")).toHaveText([
      "0 ms",
      "600 ms",
      "1,200 ms",
    ])
    await page.getByRole("button", { name: "Save Changes" }).click()

    await expect
      .poll(async () => {
        const settings = await page.evaluate(async () => {
          const result = await chrome.storage.local.get("settings:global")
          return result["settings:global"] as {
            downloads: Record<string, unknown>
            globalPolicy: { chapter: { concurrency: number; delayMs: number } }
          }
        })
        return settings.globalPolicy.chapter.delayMs
      })
      .toBe(1250)

    const settings = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("settings:global")
      return result["settings:global"] as {
        downloads: Record<string, unknown>
        globalPolicy: { chapter: { concurrency: number; delayMs: number } }
      }
    })
    expect("maxConcurrentChapters" in settings.downloads).toBe(false)
    expect("maxConcurrentDownloads" in settings.downloads).toBe(false)
    expect(settings.globalPolicy.chapter.concurrency).toBe(1)
  })

  test("keeps download destination controls in Storage instead of General", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=general`
    )
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole("heading", {
        name: "Download defaults for new tasks",
        exact: true,
      })
    ).toHaveCount(0)

    await page.getByRole("button", { name: /Storage/i }).click()
    await expect(
      page.getByRole("heading", {
        name: "Download defaults for new tasks",
        exact: true,
      })
    ).toBeVisible()
  })

  test("scrolls the settings pane within a fixed page shell", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=integrations`
    )
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole("heading", { name: "Site Integrations" })
    ).toBeVisible()

    const metrics = await page.evaluate(() => ({
      rootScrollHeight: document.documentElement.scrollHeight,
      rootClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      bodyClientHeight: document.body.clientHeight,
    }))

    expect(metrics.rootScrollHeight).toBeLessThanOrEqual(
      metrics.rootClientHeight + 1
    )
    expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(
      metrics.bodyClientHeight + 1
    )

    const overflow = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).overflowY,
      body: getComputedStyle(document.body).overflowY,
      appRoot: getComputedStyle(document.getElementById("root")!).overflowY,
      main: getComputedStyle(document.querySelector("main")!).overflowY,
    }))

    expect(overflow.root).toBe("hidden")
    expect(overflow.body).toBe("hidden")
    expect(overflow.appRoot).toBe("hidden")
    expect(overflow.main).toBe("auto")
  })

  test("shows Chrome Web Store update controls in General", async ({
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/options.html?tab=general`
    )
    await page.waitForLoadState("domcontentloaded")

    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole("heading", { name: "Chrome Web Store Updates" })
    ).toBeVisible()
    const installedVersion = await page.evaluate(
      () => chrome.runtime.getManifest().version
    )
    await expect(
      page.getByText(
        new RegExp(
          `Installed version ${installedVersion.replaceAll(".", "\\.")}`,
          "i"
        )
      )
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Check for Updates" })
    ).toBeVisible()
  })
})

test("keeps the current section visible and settings readable at 320 pixels", async ({
  page,
  extensionId,
}) => {
  await page.setViewportSize({ width: 320, height: 620 })
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=activity`)

  const sections = page.getByRole("navigation", { name: "Tako Settings" })
  const activity = sections.getByRole("button", { name: "Activity & History" })
  await expect(activity).toBeInViewport({ ratio: 1 })
  await expect(activity).toHaveAttribute("aria-current", "page")
  await sections.getByRole("button", { name: "General" }).press("Enter")
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible()
  await expect(page).toHaveURL(/\?tab=general$/)

  const language = page.locator("#ui-language")
  const help = page.getByText(/Chrome continues to localize/)
  await expect(language).toBeInViewport({ ratio: 1 })
  await expect(help).toBeInViewport({ ratio: 1 })
  const triggerBox = (await language.boundingBox())!
  const helpBox = (await help.boundingBox())!
  expect(
    triggerBox.y >= helpBox.y + helpBox.height ||
      triggerBox.x >= helpBox.x + helpBox.width
  ).toBe(true)

  await page.goBack()
  await expect(activity).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("heading", { name: "Activity & History" })
  ).toBeVisible()
})

test("keeps a settings dropdown within a short, narrow viewport", async ({
  page,
  extensionId,
}) => {
  await page.setViewportSize({ width: 320, height: 240 })
  await page.goto(`chrome-extension://${extensionId}/options.html`)

  const language = page.locator("#ui-language")
  await language.click()
  const list = page.getByRole("listbox")
  await expect(list).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await list.boundingBox()
      return !!bounds && bounds.y >= 0 && bounds.y + bounds.height <= 240
    })
    .toBe(true)
  await page.keyboard.press("End")
  const lastOption = list.getByRole("option").last()
  await expect(lastOption).toBeFocused()
  await expect(lastOption).toBeInViewport({ ratio: 1 })
  await page.keyboard.press("Escape")
  await expect(language).toBeFocused()
})

test("keeps moving selection surfaces aligned after rapid changes and responsive reflow", async ({
  page,
  extensionId,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 850 })
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=general`)
  const navigation = page.getByRole("navigation", { name: "Tako Settings" })
  const info = page.getByRole("radio", { name: "Info", exact: true })
  const feedback = await info.evaluate(async (button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected a radio button")
    button.click()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return {
      checked: button.getAttribute("aria-checked"),
      moving: button
        .closest('[role="radiogroup"]')!
        .querySelector(".options-indicator")!
        .getAnimations()
        .some((animation) => animation.playState === "running"),
    }
  })
  expect(feedback).toEqual({ checked: "true", moving: true })
  await page.getByRole("radio", { name: "Error", exact: true }).press("Space")
  await info.press("Space")
  await expect(info).toBeChecked()
  await expect(info).toBeFocused()

  for (const width of [1200, 320, 768]) {
    await page.setViewportSize({ width, height: 850 })
    await expect
      .poll(() =>
        page.evaluate(() => {
          return [
            ...document.querySelectorAll<HTMLElement>(
              ".options-navigation, .options-choices"
            ),
          ].every((root) => {
            const selected = root.querySelector(
              '[aria-current="page"], [role="radio"][aria-checked="true"]'
            )
            const highlight = root.querySelector(".options-indicator")
            if (!selected || !highlight) return false
            const a = selected.getBoundingClientRect(),
              b = highlight.getBoundingClientRect()
            return (
              Math.abs(a.x - b.x) < 1 &&
              Math.abs(a.y - b.y) < 1 &&
              Math.abs(a.width - b.width) < 1 &&
              Math.abs(a.height - b.height) < 1
            )
          })
        })
      )
      .toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath("general-" + width + ".png"),
    })
  }
  await page.getByRole("main").evaluate((main) => {
    main.scrollTop = main.scrollHeight
  })
  await navigation.getByRole("button", { name: "Storage & Files" }).click()
  await expect
    .poll(() => page.getByRole("main").evaluate((main) => main.scrollTop))
    .toBe(0)
  await navigation.getByRole("button", { name: "General", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "General", exact: true })
  ).toBeVisible()
  await expect(
    navigation.getByRole("button", { name: "General", exact: true })
  ).toBeFocused()
  await page.getByRole("radio", { name: "Reduce motion", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute(
    "data-tako-motion",
    "reduce"
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                (animation.playState === "running" || animation.pending) &&
                Number(animation.effect?.getTiming().duration) > 1
            ).length
      )
    )
    .toBe(0)
  await navigation.getByRole("button", { name: "Network & Speed" }).click()
  await expect(
    page.getByRole("button", { name: "Replay example", exact: true })
  ).toHaveAttribute("aria-disabled", "true")
  await page.getByTestId("request-delay-input").fill("700")
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                (animation.playState === "running" || animation.pending) &&
                Number(animation.effect?.getTiming().duration) > 1
            ).length
      )
    )
    .toBe(0)
})

test("keeps keyboard focus stable while the unsaved bar enters and exits", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const notifications = page.getByTestId("notifications-switch")
  await notifications.press("Space")
  await notifications.press("Space")
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true })
  ).toHaveCount(0)
  await expect(notifications).toBeFocused()
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion })
    await notifications.press("Space")
    const save = page.getByRole("button", { name: "Save Changes", exact: true })
    await save.press("Enter")
    await expect(save).toHaveCount(0)
    await expect(page.getByRole("main")).toBeFocused()
  }
})

test("adjusts bounded retry counts with the stepper and saves typed values", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=network`)
  const input = page.getByTestId("image-retries-input")
  const increase = page.getByRole("button", {
    name: "Increase Image Retries",
    exact: true,
  })
  const decrease = page.getByRole("button", {
    name: "Decrease Image Retries",
    exact: true,
  })
  await input.fill("0")
  await expect(decrease).toBeDisabled()
  await increase.press("Enter")
  await expect(input).toHaveValue("1")
  await decrease.click()
  await expect(input).toHaveValue("0")
  await input.fill("10")
  await expect(increase).toBeDisabled()
  await decrease.press("Enter")
  await expect(input).toHaveValue("9")
  await page.getByRole("button", { name: "Save Changes", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true })
  ).toHaveCount(0)
  await page.reload()
  await expect(input).toHaveValue("9")
})

test("previews chapter contents and retains padding while normalization is off", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=storage`)
  const preview = page.getByRole("group", {
    name: "Example output",
    exact: true,
  })
  const outputs = preview.locator(".options-output-chapter summary")
  await expect(outputs).toHaveText([
    "Chapter 1.cbz",
    "Chapter 2.cbz",
    "Chapter 3.cbz",
  ])
  await page.getByTestId("image-padding-select").click()
  await page.getByRole("option", { name: /^4/ }).click()
  const first = preview.locator(".options-output-contents").first()
  await expect(first.getByText("0001.jpg", { exact: true })).toBeVisible()
  await page.getByTestId("normalize-switch").click()
  await expect(page.getByTestId("image-padding-select")).toHaveCount(0)
  await expect(first.getByText("scan-1.jpg", { exact: true })).toBeVisible()
  await page.getByTestId("cover-image-switch").click()
  await page.getByTestId("comicinfo-switch").click()
  await expect(first.getByText("000-cover.jpg", { exact: true })).toHaveCount(0)
  await expect(first.getByText("ComicInfo.xml", { exact: true })).toHaveCount(0)
  await page.locator('label[for="format-none"]').click()
  await expect(outputs).toHaveText(["Chapter 1", "Chapter 2", "Chapter 3"])
  await expect(first.getByText("001-scan-1.jpg", { exact: true })).toBeVisible()
  await page.getByTestId("normalize-switch").click()
  await expect(page.getByTestId("image-padding-select")).toContainText("4")
  await expect(first.getByText("0001.jpg", { exact: true })).toBeVisible()
})

test("uses shared macro shortcuts for a persisted site path override", async ({
  page,
  extensionId,
}) => {
  await page.goto(
    `chrome-extension://${extensionId}/options.html?tab=integrations`
  )
  const card = page.getByTestId("site-integration-card-mangadex")
  await page.getByTestId("configure-site-integration-mangadex").click()
  await expect(
    card.getByRole("textbox", { name: "Save subfolder path", exact: true })
  ).toHaveAccessibleDescription(/download location/)
  await card.getByTitle("<SERIES_TITLE>", { exact: true }).click()
  await card.getByTitle("<VOLUME_NUMBER>", { exact: true }).click()
  await expect(card.locator("#mangadex-path")).toHaveValue(
    "<SERIES_TITLE>/<VOLUME_NUMBER>"
  )
  await page.getByRole("button", { name: "Save Changes", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true })
  ).toHaveCount(0)
  await page.reload()
  await page.getByTestId("configure-site-integration-mangadex").click()
  await expect(card.locator("#mangadex-path")).toHaveValue(
    "<SERIES_TITLE>/<VOLUME_NUMBER>"
  )
  await card.locator("#mangadex-path").fill("")
  await expect(card.getByText("Override", { exact: true })).toHaveCount(0)
})

test("edits MangaDex settings directly and clears shared overrides independently", async ({
  page,
  extensionId,
}) => {
  await page.goto(
    `chrome-extension://${extensionId}/options.html?tab=integrations`
  )
  const card = page.getByTestId("site-integration-card-mangadex")
  const configure = page.getByTestId("configure-site-integration-mangadex")
  const quality = card.getByRole("combobox", { name: "Image quality" })
  const imageRetries = card.getByRole("spinbutton", { name: "Image Retries" })
  const chapterRetries = card.getByRole("spinbutton", {
    name: "Chapter Retries",
  })
  const viewOverrides = page.getByRole("button", { name: "View overrides" })
  const save = page.getByRole("button", { name: "Save Changes", exact: true })

  await configure.click()
  await expect(quality).toHaveText("Data saver")
  await quality.evaluate((control) =>
    control.scrollIntoView({ block: "center" })
  )
  await quality.click()
  const fullQuality = page.getByRole("option", { name: "Full quality" })
  await expect(fullQuality).toBeInViewport()
  await fullQuality.click()
  await expect(viewOverrides).toBeHidden()
  await expect(imageRetries).toHaveAccessibleDescription("Global Default")
  await imageRetries.fill("0")
  await expect(imageRetries).toHaveAccessibleDescription("Override")
  await expect(chapterRetries).toHaveAccessibleDescription("Global Default")
  await expect(viewOverrides).toBeVisible()
  await save.click()
  await expect(save).toBeHidden()

  await page.reload()
  await configure.click()
  await expect(quality).toHaveText("Full quality")
  await expect(imageRetries).toHaveValue("0")
  await card.getByRole("button", { name: "Clear Overrides" }).click()
  await expect(viewOverrides).toBeHidden()
  await configure.click()
  await expect(quality).toHaveText("Full quality")
  await expect(imageRetries).toHaveAccessibleDescription("Global Default")
  await card.getByRole("button", { name: "Reset to Default" }).click()
  await expect(quality).toHaveText("Data saver")
  await save.click()
  await expect(save).toBeHidden()
  await page.reload()
  await configure.click()
  await expect(quality).toHaveText("Data saver")
  await expect(viewOverrides).toBeHidden()
})

test("replays a finite pacing example and stops motion when the OS preference changes", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=network`)
  await expect(
    page.getByRole("heading", { name: "Debug Settings", exact: true })
  ).toHaveCount(0)
  const preview = page.getByRole("group", {
    name: "Request pattern",
    exact: true,
  })
  await page.getByTestId("request-delay-input").fill("1000")
  await page.getByTestId("chapter-delay-input").fill("2000")
  await page
    .getByRole("slider", { name: "Image Concurrency", exact: true })
    .press("End")
  await expect(preview.locator(".options-image-slot")).toHaveCount(10)
  await expect(preview.getByRole("listitem")).toHaveText([
    "0 ms",
    "1,000 ms",
    "2,000 ms",
  ])
  const replay = preview.getByRole("button", {
    name: "Replay example",
    exact: true,
  })
  const running = await replay.evaluate(async (button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected replay button")
    button.click()
    await new Promise(requestAnimationFrame)
    return document
      .getAnimations()
      .some(
        (animation) => animation.playState === "running" || animation.pending
      )
  })
  expect(running).toBe(true)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" || animation.pending
              ).length
        ),
      { timeout: 5000 }
    )
    .toBe(0)
  await replay.focus()
  await replay.press("Enter")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(replay).toHaveAttribute("aria-disabled", "true")
  await expect(replay).toBeFocused()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                (animation.playState === "running" || animation.pending) &&
                Number(animation.effect?.getTiming().duration) > 1
            ).length
      )
    )
    .toBe(0)
  await page.getByRole("button", { name: "General", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Debug Settings", exact: true })
  ).toBeVisible()
})

test("distinguishes save folders, chapter outputs, and contained files by format", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html?tab=storage`)
  const folder = page.getByRole("textbox", {
    name: "Save subfolder path",
    exact: true,
  })
  const chapterName = page.getByRole("textbox", {
    name: "Archive filename",
    exact: true,
  })
  await expect(folder).toHaveAccessibleDescription(/download location/)
  await expect(chapterName).toHaveAccessibleDescription(/\.cbz.*automatically/)
  await folder.fill("Library/<SERIES_TITLE>")
  await chapterName.fill("Episode <CHAPTER_NUMBER_PAD2>")
  const preview = page.getByRole("group", {
    name: "Example output",
    exact: true,
  })
  await expect(preview.locator("summary").first()).toHaveText("Episode 01.cbz")
  await expect(
    preview.getByText("01.jpg", { exact: true }).first()
  ).toBeVisible()
  const archiveContents = page.getByRole("group", {
    name: "Files inside each archive",
    exact: true,
  })
  await expect(archiveContents.getByTestId("normalize-switch")).toBeVisible()
  await expect(archiveContents.locator("#filename-template")).toHaveCount(0)

  await page.locator('label[for="format-zip"]').click()
  await expect(chapterName).toHaveValue("Episode <CHAPTER_NUMBER_PAD2>")
  await expect(chapterName).toHaveAccessibleDescription(/\.zip.*automatically/)
  await expect(page.locator(".options-file-extension")).toHaveText(".zip")
  await expect(preview.locator("summary").first()).toHaveText("Episode 01.zip")

  await page.locator('label[for="format-none"]').click()
  const chapterFolder = page.getByRole("textbox", {
    name: "Chapter folder name",
    exact: true,
  })
  await expect(chapterFolder).toHaveValue("Episode <CHAPTER_NUMBER_PAD2>")
  await expect(chapterFolder).toHaveAccessibleDescription(/folder per chapter/)
  await expect(chapterName).toHaveCount(0)
  await expect(page.locator(".options-file-extension")).toHaveCount(0)
  await expect(archiveContents).toHaveCount(0)
  await expect(
    page
      .getByRole("group", {
        name: "Files inside each chapter folder",
        exact: true,
      })
      .getByTestId("normalize-switch")
  ).toBeVisible()
  await expect(preview.locator("summary").first()).toHaveText("Episode 01")
  await expect(
    preview.getByText("01.jpg", { exact: true }).first()
  ).toBeVisible()
  await expect(folder).toHaveValue("Library/<SERIES_TITLE>")

  await page.locator('label[for="format-cbz"]').click()
  await expect(chapterName).toHaveValue("Episode <CHAPTER_NUMBER_PAD2>")
  await expect(archiveContents).toBeVisible()
})
