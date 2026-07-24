import { test, expect } from "./fixtures/extension"
import { OptionsPageObject } from "./pages/options"

test.describe("UI preferences", () => {
  test("applies a saved manual language live in Options and Side Panel", async ({
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
    await page.getByRole("option", { name: "日本語" }).click()
    await options.saveSettings()

    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(sidepanel.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.getByText("インターフェース")).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await chrome.storage.local.get("settings:global")
          return (result["settings:global"] as { uiLanguage?: string })
            ?.uiLanguage
        })
      )
      .toBe("ja")

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.getByText("インターフェース")).toBeVisible()
    await sidepanel.close()
  })

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
