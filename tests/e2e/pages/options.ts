import { expect, Page } from "@playwright/test"
import type { OptionsSection } from "@/entrypoints/options/tab-routing"

export class OptionsPageObject {
  readonly page: Page
  readonly extensionId: string

  constructor(page: Page, extensionId: string) {
    this.page = page
    this.extensionId = extensionId
  }

  async navigate(tab?: OptionsSection): Promise<void> {
    const search = tab ? `?tab=${tab}` : ""
    await this.page.goto(
      `chrome-extension://${this.extensionId}/options.html${search}`
    )
    await this.page.waitForLoadState("domcontentloaded")
    await expect(this.page.locator("#root")).toBeVisible({ timeout: 5000 })
  }

  async switchToSection(section: OptionsSection): Promise<void> {
    const labels: Record<OptionsSection, string> = {
      general: "General",
      storage: "Storage & Files",
      network: "Network & Speed",
      integrations: "Site Integrations",
      activity: "Activity & History",
    }
    await this.page
      .getByRole("button", { name: labels[section], exact: true })
      .click()
  }
  async getArchiveFormat(): Promise<string> {
    if (
      (await this.page
        .locator('[data-testid="archive-format-radiogroup"]')
        .count()) === 0
    ) {
      await this.switchToSection("storage")
    }
    const radioGroup = this.page.locator(
      '[data-testid="archive-format-radiogroup"]'
    )
    const checkedRadio = radioGroup.getByRole("radio", { checked: true })
    const value = await checkedRadio.getAttribute("value")
    expect(value).toMatch(/^(cbz|zip|none)$/)
    return value!
  }

  async setArchiveFormat(format: "cbz" | "zip" | "none"): Promise<void> {
    if (
      (await this.page
        .locator('[data-testid="archive-format-radiogroup"]')
        .count()) === 0
    ) {
      await this.switchToSection("storage")
    }
    const formatLabels = {
      cbz: "format-cbz",
      zip: "format-zip",
      none: "format-none",
    }
    await this.page.locator(`label[for="${formatLabels[format]}"]`).click()
  }

  async getFileNameTemplate(): Promise<string> {
    if (
      (await this.page
        .locator('[data-testid="filename-template-input"]')
        .count()) === 0
    ) {
      await this.switchToSection("storage")
    }
    return await this.page
      .locator('[data-testid="filename-template-input"]')
      .inputValue()
  }

  async setFileNameTemplate(template: string): Promise<void> {
    if (
      (await this.page
        .locator('[data-testid="filename-template-input"]')
        .count()) === 0
    ) {
      await this.switchToSection("storage")
    }
    await this.page
      .locator('[data-testid="filename-template-input"]')
      .fill(template)
  }

  async areNotificationsEnabled(): Promise<boolean> {
    if (
      (await this.page
        .getByRole("switch", { name: "Enable Notifications" })
        .count()) === 0
    ) {
      await this.switchToSection("general")
    }
    const state = await this.page
      .getByRole("switch", { name: "Enable Notifications" })
      .getAttribute("data-state")
    return state === "checked"
  }

  async toggleNotifications(): Promise<void> {
    if (
      (await this.page
        .getByRole("switch", { name: "Enable Notifications" })
        .count()) === 0
    ) {
      await this.switchToSection("general")
    }
    const switchControl = this.page.getByRole("switch", {
      name: "Enable Notifications",
    })
    await switchControl.click()
    await switchControl.waitFor({ state: "visible" })
  }

  async isComicInfoEnabled(): Promise<boolean> {
    if (
      (await this.page.locator('[data-testid="comicinfo-switch"]').count()) ===
      0
    ) {
      await this.switchToSection("storage")
    }
    const state = await this.page
      .locator('[data-testid="comicinfo-switch"]')
      .getAttribute("data-state")
    return state === "checked"
  }

  async toggleComicInfo(): Promise<void> {
    if (
      (await this.page.locator('[data-testid="comicinfo-switch"]').count()) ===
      0
    ) {
      await this.switchToSection("storage")
    }
    await this.page.locator('[data-testid="comicinfo-switch"]').click()
  }

  async isImageNormalizationEnabled(): Promise<boolean> {
    if (
      (await this.page.locator('[data-testid="normalize-switch"]').count()) ===
      0
    ) {
      await this.switchToSection("storage")
    }
    const state = await this.page
      .locator('[data-testid="normalize-switch"]')
      .getAttribute("data-state")
    return state === "checked"
  }

  async toggleImageNormalization(): Promise<void> {
    if (
      (await this.page.locator('[data-testid="normalize-switch"]').count()) ===
      0
    ) {
      await this.switchToSection("storage")
    }
    await this.page.locator('[data-testid="normalize-switch"]').click()
  }

  async saveSettings(): Promise<void> {
    const saveButton = this.page.getByRole("button", { name: "Save Changes" })
    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click()
      await this.waitForSaveSuccess()
    }
  }

  async waitForSaveSuccess(): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: "Save Changes" })
    ).toBeHidden({ timeout: 5000 })
  }

  async setDirectoryTemplate(pathTemplate: string): Promise<void> {
    if (
      (await this.page
        .locator('[data-testid="download-path-input"]')
        .count()) === 0
    ) {
      await this.switchToSection("storage")
    }
    await this.page
      .locator('[data-testid="download-path-input"]')
      .fill(pathTemplate)
  }

  async getDirectoryTemplate(): Promise<string> {
    if (
      (await this.page
        .locator('[data-testid="download-path-input"]')
        .count()) === 0
    ) {
      await this.switchToSection("storage")
    }
    return await this.page
      .locator('[data-testid="download-path-input"]')
      .inputValue()
  }
}
