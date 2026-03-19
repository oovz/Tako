import { Page } from '@playwright/test';

export class OptionsPageObject {
  readonly page: Page;
  readonly extensionId: string;

  constructor(page: Page, extensionId: string) {
    this.page = page;
    this.extensionId = extensionId;
  }

  async navigate(): Promise<void> {
    await this.page.goto(`chrome-extension://${this.extensionId}/options.html`);
    await this.page.waitForLoadState('domcontentloaded');
    // Wait for root content to be ready so main controls are present
    await this.page.waitForSelector('[data-testid="archive-format-radiogroup"]', { timeout: 5000 }).catch(() => {});
  }

  // Sidebar navigation (Options page uses sidebar, not tabs)
  async switchToSection(section: 'General' | 'Site Integrations' | 'Downloads' | 'About / Debug'): Promise<void> {
    await this.page.getByRole('button', { name: section }).click();
  }

  // Ensure settings are initialized (test helper)
  async ensureInitialized(): Promise<void> {
    // Wait for known elements to appear; fallback to no-op
    await this.page.waitForSelector('[data-testid="archive-format-radiogroup"]', { timeout: 5000 }).catch(() => {});
  }

  // General Settings - Using Accessible Selectors
  async getArchiveFormat(): Promise<string> {
    // RadioGroup - find checked radio button
    const radioGroup = this.page.locator('[data-testid="archive-format-radiogroup"]');
    const checkedRadio = radioGroup.getByRole('radio', { checked: true });
    const value = await checkedRadio.getAttribute('value');
    return value || 'cbz';
  }

  async setArchiveFormat(format: 'cbz' | 'zip' | 'none'): Promise<void> {
    // Click the label for the format option
    const formatLabels = {
      'cbz': 'format-cbz',
      'zip': 'format-zip',
      'none': 'format-none'
    };
    await this.page.locator(`label[for="${formatLabels[format]}"]`).click();
  }

  async getFileNameTemplate(): Promise<string> {
    return await this.page.locator('[data-testid="filename-template-input"]').inputValue();
  }

  async setFileNameTemplate(template: string): Promise<void> {
    await this.page.locator('[data-testid="filename-template-input"]').fill(template);
  }


  // Rate Limiting Settings - Using data-testid Selectors
  async getImageConcurrency(): Promise<number> {
    // Slider doesn't have inputValue - get aria-valuenow or read display text
    const slider = this.page.locator('[data-testid="image-concurrency-slider"]');
    const value = await slider.getAttribute('aria-valuenow');
    return parseInt(value || '3', 10);
  }

  async getRequestDelay(): Promise<number> {
    const value = await this.page.locator('[data-testid="request-delay-input"]').inputValue();
    return parseInt(value, 10);
  }

  async setRequestDelay(delayMs: number): Promise<void> {
    await this.page.locator('[data-testid="request-delay-input"]').fill(String(delayMs));
  }

  // Notifications Settings
  async areNotificationsEnabled(): Promise<boolean> {
    const state = await this.page.getByRole('switch', { name: 'Enable Notifications' }).getAttribute('data-state');
    return state === 'checked';
  }

  async toggleNotifications(): Promise<void> {
    const switchControl = this.page.getByRole('switch', { name: 'Enable Notifications' });
    await switchControl.click();
    await switchControl.waitFor({ state: 'visible' });
  }

  // ComicInfo Settings
  async isComicInfoEnabled(): Promise<boolean> {
    const state = await this.page.locator('[data-testid="comicinfo-switch"]').getAttribute('data-state');
    return state === 'checked';
  }

  async toggleComicInfo(): Promise<void> {
    await this.page.locator('[data-testid="comicinfo-switch"]').click();
  }

  // Image Normalization
  async isImageNormalizationEnabled(): Promise<boolean> {
    const state = await this.page.locator('[data-testid="normalize-switch"]').getAttribute('data-state');
    return state === 'checked';
  }

  async toggleImageNormalization(): Promise<void> {
    await this.page.locator('[data-testid="normalize-switch"]').click();
  }

  // Site Integrations
  async getSiteIntegrationCount(): Promise<number> {
    return await this.page.locator('[data-testid^="site-integration-card-"]').count();
  }

  async clickConfigureSiteIntegration(siteIntegrationId: string): Promise<void> {
    await this.page.locator(`[data-testid="configure-site-integration-${siteIntegrationId}"]`).click();
  }

  async resetSiteIntegrationOverrides(siteIntegrationId: string): Promise<void> {
    await this.page.locator(`[data-testid="reset-site-integration-overrides-${siteIntegrationId}"]`).click();
  }

  // Download History
  async clearDownloadHistory(): Promise<void> {
    await this.page.locator('[data-testid="clear-history-button"]').click();
    // Confirm in dialog
    await this.page.getByRole('button', { name: 'Clear History' }).click();
  }

  // Custom Download Path
  async hasCustomDownloadPath(): Promise<boolean> {
    const text = await this.page.locator('[data-testid="download-path-status"]').textContent();
    return text?.includes('Custom path set') ?? false;
  }

  async chooseDownloadFolder(): Promise<void> {
    // This will trigger the File System Access API picker
    // In tests, we'll need to mock this
    await this.page.locator('[data-testid="choose-download-folder-button"]').click();
  }

  // Save Settings
  async saveSettings(): Promise<void> {
    // Click the save button if there are unsaved changes
    const saveButton = this.page.getByRole('button', { name: 'Save Changes' });
    if (await saveButton.count()) {
      await saveButton.click();
    }
  }

  // Import/Export Settings
  async exportSettings(): Promise<void> {
    await this.page.locator('[data-testid="export-settings-button"]').click();
  }

  async importSettings(filePath: string): Promise<void> {
    await this.page.locator('[data-testid="import-settings-input"]').setInputFiles(filePath);
  }

  // Helper methods
  async hasElement(selector: string): Promise<boolean> {
    return await this.page.locator(selector).count() > 0;
  }

  async waitForSaveSuccess(): Promise<void> {
    // After saving, the button label should change to "Saved"
    const savedButton = this.page.getByRole('button', { name: 'Saved' });
    await savedButton.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
      // Fallback: ensure no pending "Save Changes" button is visible
      await this.page.getByRole('button', { name: 'Save Changes' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    });
  }

  // ============================================================================
  // SITE INTEGRATION MANAGEMENT - Using Accessible Selectors
  // ============================================================================

  /**
   * Search for site integrations by name or domain
   */
  async searchSiteIntegrations(query: string): Promise<void> {
    // Wait for integration list to load
    await this.page.waitForSelector('h2:has-text("Site Integrations")', { timeout: 5000 });
    
    // Wait for at least one site integration card to be visible
    await this.page.waitForSelector('[class*="card"]', { timeout: 5000 });
    
    const searchInput = this.page.getByPlaceholder('Search site integrations by name or domain...');
    await searchInput.clear();
    await searchInput.fill(query);
    await this.page.waitForTimeout(300); // Debounce delay + filter time
  }

  /**
   * Select a site integration card by name
   */
  async selectSiteIntegration(siteIntegrationName: string) {
    // Wait for integration list to load
    await this.page.waitForSelector('h2:has-text("Site Integrations")', { timeout: 5000 });
    
    // Find the site integration card by its title text
    // The CardTitle component contains the site integration name
    const siteIntegrationCard = this.page.locator('[class*="card"]').filter({ hasText: siteIntegrationName }).first();
    await siteIntegrationCard.waitFor({ state: 'visible', timeout: 5000 });
    await siteIntegrationCard.scrollIntoViewIfNeeded();
    return siteIntegrationCard;
  }

  /**
   * Enable site-integration-specific override
   */
  async enableSiteIntegrationOverride(siteIntegrationName: string): Promise<void> {
    // Wait for site integrations to load
    await this.page.waitForTimeout(500);
    
    const card = await this.selectSiteIntegration(siteIntegrationName);
    
    // Expand the card if collapsed (Radix Collapsible)
    const expandButton = card.getByRole('button').first();
    await expandButton.click();
    await this.page.waitForTimeout(200); // Wait for expansion animation
  }

  /**
   * Disable site-integration-specific override
   */
  async disableSiteIntegrationOverride(siteIntegrationName: string): Promise<void> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    const resetButton = card.getByRole('button', { name: /reset to global defaults/i });
    if (await resetButton.isVisible()) {
      await resetButton.click();
    }
  }

  /**
   * Check if a site integration has an active override
   */
  async hasSiteIntegrationOverride(siteIntegrationName: string): Promise<boolean> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    return await card.getByText(/override active/i).isVisible();
  }

  /**
   * Set site-integration-specific chapter concurrency
   */
  async setSiteIntegrationChapterConcurrency(siteIntegrationName: string, concurrency: number): Promise<void> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    await this.enableSiteIntegrationOverride(siteIntegrationName);
    const input = card.getByRole('spinbutton').filter({ hasText: /chapter/i }).or(card.getByRole('spinbutton').nth(0));
    await input.fill(concurrency.toString());
  }

  /**
   * Get site-integration-specific chapter concurrency
   */
  async getSiteIntegrationChapterConcurrency(siteIntegrationName: string): Promise<number> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    const input = card.getByRole('spinbutton').filter({ hasText: /chapter/i }).or(card.getByRole('spinbutton').nth(0));
    const value = await input.inputValue();
    return parseInt(value, 10);
  }

  /**
   * Set site-integration-specific image concurrency
   */
  async setSiteIntegrationImageConcurrency(siteIntegrationName: string, concurrency: number): Promise<void> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    await this.enableSiteIntegrationOverride(siteIntegrationName);
    const input = card.getByRole('spinbutton').filter({ hasText: /image/i }).or(card.getByRole('spinbutton').nth(1));
    await input.fill(concurrency.toString());
  }

  /**
   * Get site-integration-specific image concurrency
   */
  async getSiteIntegrationImageConcurrency(siteIntegrationName: string): Promise<number> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    const input = card.getByRole('spinbutton').filter({ hasText: /image/i }).or(card.getByRole('spinbutton').nth(1));
    const value = await input.inputValue();
    return parseInt(value, 10);
  }

  /**
   * Set site-integration-specific image delay (ms)
   */
  async setSiteIntegrationImageDelay(siteIntegrationName: string, delayMs: number): Promise<void> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    await this.enableSiteIntegrationOverride(siteIntegrationName);
    const input = card.getByRole('spinbutton').filter({ hasText: /delay/i }).or(card.getByRole('spinbutton').nth(2));
    await input.fill(delayMs.toString());
  }

  /**
   * Get site-integration-specific image delay (ms)
   */
  async getSiteIntegrationImageDelay(siteIntegrationName: string): Promise<number> {
    const card = await this.selectSiteIntegration(siteIntegrationName);
    const input = card.getByRole('spinbutton').filter({ hasText: /delay/i }).or(card.getByRole('spinbutton').nth(2));
    const value = await input.inputValue();
    return parseInt(value, 10);
  }

  // ============================================================================
  // ADVANCED SETTINGS - Using Accessible Selectors
  // ============================================================================

  /**
   * Set log level
   */
  async setLogLevel(level: 'error' | 'warn' | 'info' | 'debug'): Promise<void> {
    await this.page.locator('[data-testid="log-level-select"]').click();
    const levelMap = {
      error: 'Error',
      warn: 'Warning',
      info: 'Info',
      debug: 'Debug',
    };
    await this.page.getByRole('option', { name: levelMap[level] }).click();
  }

  /**
   * Get current log level
   */
  async getLogLevel(): Promise<string> {
    const trigger = this.page.locator('[data-testid="log-level-select"]');
    const text = (await trigger.textContent() || '').trim();
    
    const logLevelMap: Record<string, string> = {
      'Error': 'error',
      'Warning': 'warn',
      'Info': 'info',
      'Debug': 'debug'
    };
    
    return logLevelMap[text] || text.toLowerCase();
  }

  /**
   * Check if debug logging is enabled (logLevel === 'debug')
   */
  async isDebugLoggingEnabled(): Promise<boolean> {
    const level = await this.getLogLevel();
    return level === 'debug';
  }

  /**
   * Set storage cleanup days
   */
  async setStorageCleanupDays(days: number): Promise<void> {
    await this.page.locator('[data-testid="storage-cleanup-input"]').fill(days.toString());
  }

  /**
   * Get storage cleanup days
   */
  async getStorageCleanupDays(): Promise<number> {
    const value = await this.page.locator('[data-testid="storage-cleanup-input"]').inputValue();
    return parseInt(value, 10);
  }

  // ============================================================================
  // NOTIFICATIONS - Using Accessible Selectors
  // ============================================================================

  /**
   * Enable notifications
   */
  async enableNotifications(): Promise<void> {
    const state = await this.page.locator('[data-testid="notifications-switch"]').getAttribute('data-state');
    if (state !== 'checked') {
      await this.page.locator('[data-testid="notifications-switch"]').click();
    }
  }

  /**
   * Disable notifications
   */
  async disableNotifications(): Promise<void> {
    const state = await this.page.locator('[data-testid="notifications-switch"]').getAttribute('data-state');
    if (state === 'checked') {
      await this.page.locator('[data-testid="notifications-switch"]').click();
    }
  }

  /**
   * Check if notifications are enabled
   */
  async isNotificationsEnabled(): Promise<boolean> {
    const state = await this.page.locator('[data-testid="notifications-switch"]').getAttribute('data-state');
    return state === 'checked';
  }

  // ============================================================================
  // DOWNLOAD PATH AND FILE OPTIONS - Using Accessible Selectors
  // ============================================================================

  /**
   * Set directory path template
   */
  async setDirectoryTemplate(pathTemplate: string): Promise<void> {
    await this.page.locator('[data-testid="download-path-input"]').fill(pathTemplate);
  }

  /**
   * Get directory path template
   */
  async getDirectoryTemplate(): Promise<string> {
    return await this.page.locator('[data-testid="download-path-input"]').inputValue();
  }

  /**
   * Set overwrite existing files
   */
  async setOverwriteExisting(overwrite: boolean): Promise<void> {
    const state = await this.page.locator('[data-testid="overwrite-switch"]').getAttribute('data-state');
    const isChecked = state === 'checked';
    if (overwrite !== isChecked) {
      await this.page.locator('[data-testid="overwrite-switch"]').click();
    }
  }

  /**
   * Get overwrite existing files setting
   */
  async getOverwriteExisting(): Promise<boolean> {
    const state = await this.page.locator('[data-testid="overwrite-switch"]').getAttribute('data-state');
    return state === 'checked';
  }

  /**
   * Set include ComicInfo.xml
   */
  async setIncludeComicInfo(include: boolean): Promise<void> {
    const state = await this.page.locator('[data-testid="comicinfo-switch"]').getAttribute('data-state');
    const isChecked = state === 'checked';
    if (include !== isChecked) {
      await this.page.locator('[data-testid="comicinfo-switch"]').click();
    }
  }

  /**
   * Get include ComicInfo.xml setting
   */
  async getIncludeComicInfo(): Promise<boolean> {
    const state = await this.page.locator('[data-testid="comicinfo-switch"]').getAttribute('data-state');
    return state === 'checked';
  }
}

export async function openOptions(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  
  // Wait for options page to be ready
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="archive-format-radiogroup"]', { timeout: 5000 }).catch(() => {});
  
  return {
    page,
    
    // Helper to check if element exists
    hasElement: async (selector: string) => {
      return await page.locator(selector).count() > 0;
    },
    
    // Helper to get input value
    getValue: async (selector: string) => {
      const element = page.locator(selector);
      return await element.inputValue();
    },
    
    // Helper to set input value
    setValue: async (selector: string, value: string) => {
      await page.locator(selector).fill(value);
    },
    
    // Helper to click element
    click: async (selector: string) => {
      await page.locator(selector).click();
    },
  };
}
