import { test, expect } from "./fixtures/extension"
import { OptionsPageObject } from "./pages/options"

test.describe("UI preferences", () => {
  for (const { locale, displayName, interfaceLabel } of [
    { locale: "ja", displayName: "日本語", interfaceLabel: "インターフェース" },
    { locale: "ko", displayName: "한국어", interfaceLabel: "인터페이스" },
  ]) {
    test(`applies saved ${locale} live in Options and Side Panel`, async ({
      context,
      extensionId,
      page,
    }) => {
      const options = new OptionsPageObject(page, extensionId)
      await options.navigate()
      const sidepanel = await context.newPage()
      await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
        waitUntil: "domcontentloaded",
      })

      await page.locator("#ui-language").click()
      await page.getByRole("option", { name: displayName }).click()
      await options.saveSettings()

      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      await expect(sidepanel.locator("html")).toHaveAttribute("lang", locale)
      await expect(page.getByText(interfaceLabel)).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const result = await chrome.storage.local.get("settings:global")
            return (result["settings:global"] as { uiLanguage?: string })
              ?.uiLanguage
          })
        )
        .toBe(locale)

      await page.reload({ waitUntil: "domcontentloaded" })
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      await expect(page.getByText(interfaceLabel)).toBeVisible()
      await sidepanel.close()
    })
  }

  test("previews, saves, and synchronizes both motion preferences", async ({
    context,
    extensionId,
    page,
  }) => {
    const options = new OptionsPageObject(page, extensionId)
    await options.navigate()
    const sidepanel = await context.newPage()
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.locator("html")).not.toHaveAttribute("data-tako-motion")
    await expect(sidepanel.locator("html")).not.toHaveAttribute(
      "data-tako-motion"
    )

    await page.locator("#motion-preference").click()
    await page.getByRole("option", { name: "Reduce motion" }).click()
    await expect(page.locator("html")).toHaveAttribute(
      "data-tako-motion",
      "reduce"
    )
    await expect(sidepanel.locator("html")).not.toHaveAttribute(
      "data-tako-motion"
    )

    await options.saveSettings()

    await expect(sidepanel.locator("html")).toHaveAttribute(
      "data-tako-motion",
      "reduce"
    )

    await page.locator("#motion-preference").click()
    await page.getByRole("option", { name: "Follow system setting" }).click()
    await expect(page.locator("html")).not.toHaveAttribute("data-tako-motion")
    await options.saveSettings()
    await expect(sidepanel.locator("html")).not.toHaveAttribute(
      "data-tako-motion"
    )
    await sidepanel.close()
  })
})
