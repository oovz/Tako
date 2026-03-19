/**
 * @file manga-page-object.ts
 * @description Page object model for interacting with manga series pages during E2E tests
 */

import { Page } from '@playwright/test';

export class MangaPageObject {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a mock manga series page
   */
  async navigate(url: string): Promise<void> {
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get the shadow root of the on-page UI
   */
  async getShadowRoot(): Promise<ReturnType<typeof this.page.locator> | null> {
    return null;
  }

  /**
   * Check if on-page UI is injected
   */
  async hasOnPageUI(): Promise<boolean> {
    const shadowRoot = await this.getShadowRoot();
    return shadowRoot !== null;
  }

  /**
   * Get chapter checkbox by index
   */
  async getChapterCheckbox(index: number) {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    return shadowRoot.locator(`[data-testid="chapter-checkbox-${index}"]`);
  }

  /**
   * Get volume checkbox by volume number
   */
  async getVolumeCheckbox(volumeNumber: number) {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    return shadowRoot.locator(`[data-testid="volume-checkbox-${volumeNumber}"]`);
  }

  /**
   * Click "Select All" button
   */
  async clickSelectAll(): Promise<void> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    await shadowRoot.locator('[data-testid="select-all-button"]').click();
  }

  /**
   * Click "Deselect All" button
   */
  async clickDeselectAll(): Promise<void> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    await shadowRoot.locator('[data-testid="deselect-all-button"]').click();
  }

  /**
   * Click "Download Selected" button
   */
  async clickDownloadSelected(): Promise<void> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    await shadowRoot.locator('[data-testid="download-selected-button"]').click();
  }

  /**
   * Click "Download New" button
   */
  async clickDownloadNew(): Promise<void> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    await shadowRoot.locator('[data-testid="download-new-button"]').click();
  }

  /**
   * Get selected chapter count text
   */
  async getSelectedCount(): Promise<string> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    const element = shadowRoot.locator('[data-testid="selected-count"]');
    return (await element.textContent()) ?? '';
  }

  /**
   * Get chapter status badge (new, downloaded, etc.)
   */
  async getChapterBadge(chapterIndex: number): Promise<string | null> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    const badge = shadowRoot.locator(`[data-testid="chapter-badge-${chapterIndex}"]`);
    const hasBadge = await badge.count() > 0;
    
    if (!hasBadge) return null;
    return (await badge.textContent()) ?? null;
  }

  /**
   * Select chapters by shift-clicking
   */
  async shiftSelectChapters(startIndex: number, endIndex: number): Promise<void> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    // Click first checkbox
    await shadowRoot.locator(`[data-testid="chapter-checkbox-${startIndex}"]`).click();

    // Shift-click last checkbox
    await this.page.keyboard.down('Shift');
    await shadowRoot.locator(`[data-testid="chapter-checkbox-${endIndex}"]`).click();
    await this.page.keyboard.up('Shift');
  }

  /**
   * Check if download button is disabled
   */
  async isDownloadButtonDisabled(): Promise<boolean> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    const button = shadowRoot.locator('[data-testid="download-selected-button"]');
    return await button.isDisabled();
  }

  /**
   * Get download progress text
   */
  async getDownloadProgress(): Promise<string | null> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    const progress = shadowRoot.locator('[data-testid="download-progress"]');
    const hasProgress = await progress.count() > 0;
    
    if (!hasProgress) return null;
    return (await progress.textContent()) ?? null;
  }

  /**
   * Click cancel download button
   */
  async clickCancelDownload(): Promise<void> {
    const shadowRoot = await this.getShadowRoot();
    if (!shadowRoot) throw new Error('On-page UI not injected');

    await shadowRoot.locator('[data-testid="cancel-download-button"]').click();
  }

  /**
   * Wait for on-page UI to be injected
   */
  async waitForOnPageUI(timeout = 5000): Promise<void> {
    void timeout;
    return;
  }
}
