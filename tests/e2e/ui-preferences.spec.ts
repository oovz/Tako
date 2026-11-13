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
      await page
        .getByRole("button", { name: "Save Changes", exact: true })
        .click()

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

  test("shows the override banner in the selected Options language", async ({
    extensionId,
    page,
  }) => {
    const options = new OptionsPageObject(page, extensionId)
    await options.navigate()
    await page.locator("#ui-language").click()
    await page.getByRole("option", { name: "简体中文" }).click()
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click()
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")

    await options.navigate("integrations")
    const viewOverrides = page.getByRole("button", { name: "查看覆盖设置" })
    await expect(viewOverrides).toBeHidden()
    await page.getByTestId("configure-site-integration-mangadex").click()
    await page.locator("#mangadex-format").click()
    await page.getByRole("option", { name: "ZIP", exact: true }).click()

    const summary = page.getByText("有 1 个站点使用覆盖设置。", { exact: true })
    await expect(summary).toBeVisible()
    await expect(
      summary
        .locator("..")
        .locator("svg.lucide-sliders-horizontal[aria-hidden='true']")
    ).toBeVisible()
    await viewOverrides.click()
    await expect(summary).toBeHidden()
    await expect(page.getByTestId(/^site-integration-card-/)).toHaveCount(1)
    await expect(
      page.getByTestId("site-integration-card-mangadex")
    ).toBeVisible()
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

    await page.getByRole("radio", { name: "Reduce motion" }).click()
    await expect(page.locator("html")).toHaveAttribute(
      "data-tako-motion",
      "reduce"
    )
    await expect(sidepanel.locator("html")).not.toHaveAttribute(
      "data-tako-motion"
    )

    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click()

    await expect(sidepanel.locator("html")).toHaveAttribute(
      "data-tako-motion",
      "reduce"
    )

    await page.getByRole("radio", { name: "Follow system setting" }).click()
    await expect(page.locator("html")).not.toHaveAttribute("data-tako-motion")
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click()
    await expect(sidepanel.locator("html")).not.toHaveAttribute(
      "data-tako-motion"
    )
    await sidepanel.close()
  })
})
