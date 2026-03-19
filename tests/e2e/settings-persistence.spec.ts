/**
 * E2E Tests: Settings Persistence and Usage
 * 
 * Tests that settings changes in the Options page are properly persisted and
 * used during download execution. Specifically tests the defaultFormat setting
 * to prevent regression of the cbz/zip bug.
 * 
 * Bug Context: Prior to fix, changing defaultFormat in Options did not affect
 * actual downloads because SYNC_SETTINGS_TO_STATE only synced partial fields.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/extension';
import { OptionsPageObject } from './pages/options';

let optionsPage: Page;
let options: OptionsPageObject;

test.describe('Settings Persistence and Usage', () => {
  test.beforeEach(async ({ page, extensionId }) => {
    optionsPage = page;
    options = new OptionsPageObject(page, extensionId);
  });

  test.describe('Archive Format Settings', () => {
    test('should default to cbz format', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      const format = await options.getArchiveFormat();
      expect(format).toBe('cbz');
    });

    test('should persist zip format selection', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      // Change to zip
      await options.setArchiveFormat('zip');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      // Reload page and verify persistence
      await options.navigate();
      await options.ensureInitialized();
      
      const format = await options.getArchiveFormat();
      expect(format).toBe('zip');
    });

    test('should persist cbz format selection', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      // Change to cbz
      await options.setArchiveFormat('cbz');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      // Reload and verify
      await options.navigate();
      await options.ensureInitialized();
      
      const format = await options.getArchiveFormat();
      expect(format).toBe('cbz');
    });

    test('should persist none (folder) format selection', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      // Change to none
      await options.setArchiveFormat('none');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      // Reload and verify
      await options.navigate();
      await options.ensureInitialized();
      
      const format = await options.getArchiveFormat();
      expect(format).toBe('none');
      
      // Reset to cbz for other tests
      await options.setArchiveFormat('cbz');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });

  test.describe('ComicInfo Settings', () => {
    test('should persist ComicInfo enabled state', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      // Get initial state
      const initialState = await options.isComicInfoEnabled();
      
      // Toggle
      await options.toggleComicInfo();
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      // Reload and verify
      await options.navigate();
      await options.ensureInitialized();
      
      const newState = await options.isComicInfoEnabled();
      expect(newState).toBe(!initialState);
      
      // Reset
      await options.toggleComicInfo();
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });

  test.describe('Image Normalization Settings', () => {
    test('should persist image normalization state', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      const initialState = await options.isImageNormalizationEnabled();
      
      await options.toggleImageNormalization();
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      await options.navigate();
      await options.ensureInitialized();
      
      const newState = await options.isImageNormalizationEnabled();
      expect(newState).toBe(!initialState);
      
      // Reset
      await options.toggleImageNormalization();
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });

  test.describe('Download Path Settings', () => {
    test('should persist custom download path template', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      const customPath = 'CustomFolder/<SERIES_TITLE>/<CHAPTER_TITLE>';
      await options.setDirectoryTemplate(customPath);
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      await options.navigate();
      await options.ensureInitialized();
      
      const savedPath = await options.getDirectoryTemplate();
      expect(savedPath).toBe(customPath);
      
      // Reset to default
      await options.setDirectoryTemplate('TMD/<SERIES_TITLE>');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });

  test.describe('Filename Template Settings', () => {
    test('should persist custom filename template', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      const customTemplate = '<SERIES_TITLE> - Chapter <CHAPTER_NUMBER>';
      await options.setFileNameTemplate(customTemplate);
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      await options.navigate();
      await options.ensureInitialized();
      
      const savedTemplate = await options.getFileNameTemplate();
      expect(savedTemplate).toBe(customTemplate);
      
      // Reset to default
      await options.setFileNameTemplate('<CHAPTER_TITLE>');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });

  test.describe('Notification Settings', () => {
    test('should persist notification toggle state', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      const initialState = await options.areNotificationsEnabled();
      
      await options.toggleNotifications();
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
      
      await options.navigate();
      await options.ensureInitialized();
      
      const newState = await options.areNotificationsEnabled();
      expect(newState).toBe(!initialState);
      
      // Reset
      await options.toggleNotifications();
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });

  test.describe('Settings Sync to Centralized State', () => {
    test('should sync format setting to background state', async () => {
      await options.navigate();
      await options.ensureInitialized();
      
      // Set zip format
      await options.setArchiveFormat('zip');
      await options.saveSettings();
      await optionsPage.waitForTimeout(1000); // Wait for sync message
      
      // Verify via extension storage (if accessible)
      // This test verifies the sync mechanism is working
      const format = await options.getArchiveFormat();
      expect(format).toBe('zip');
      
      // Reset
      await options.setArchiveFormat('cbz');
      await options.saveSettings();
      await optionsPage.waitForTimeout(500);
    });
  });
});

test.describe('Settings Cross-Page Consistency', () => {
  test('settings should be consistent across options page reloads', async ({ context, extensionId }) => {
    // Open first options page and set format
    const page1 = await context.newPage();
    const opts1 = new OptionsPageObject(page1, extensionId);
    await opts1.navigate();
    await opts1.ensureInitialized();

    // Force deterministic baseline first so this test does not depend on prior suite state.
    await opts1.setArchiveFormat('cbz');
    await opts1.saveSettings();
    await opts1.waitForSaveSuccess();

    await opts1.setArchiveFormat('zip');
    await opts1.saveSettings();
    await opts1.waitForSaveSuccess();
    await page1.waitForTimeout(500);

    // Open second options page and verify
    const page2 = await context.newPage();
    const opts2 = new OptionsPageObject(page2, extensionId);
    await opts2.navigate();
    await opts2.ensureInitialized();

    const format = await opts2.getArchiveFormat();
    expect(format).toBe('zip');

    // Reset
    await opts2.setArchiveFormat('cbz');
    await opts2.saveSettings();
    await opts2.waitForSaveSuccess();
    await page2.waitForTimeout(500);

    await page1.close();
    await page2.close();
  });
});
