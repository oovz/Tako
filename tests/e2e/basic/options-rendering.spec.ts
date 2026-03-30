import { test, expect } from '../fixtures/extension';

test.describe('Options Page', () => {
  test('renders options page successfully', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for page content to load
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
    
    // Verify options page loaded - check for sidebar navigation
    await expect(page.getByText('Tako Settings')).toBeVisible();
    await expect(page.getByText('General')).toBeVisible();
  });
  
  test('displays download format selector', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for page content to load
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
    
    // Check for archive format RadioGroup (CBZ/ZIP/None options)
    await expect(page.locator('[data-testid="archive-format-radiogroup"]')).toBeVisible();
    await expect(page.getByText('CBZ Archive')).toBeVisible();
  });

  test('shows the no-archive shelf warning alongside archive format settings', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });

    await page.locator('label[for="format-none"]').click();

    await expect(page.getByText('No archive + default downloads can clutter the download shelf')).toBeVisible();

    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.getByText('No archive + default downloads can clutter the download shelf')).toHaveCount(0);
  });

  test('keeps download destination controls in Downloads instead of General', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Download Location')).toHaveCount(0);

    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.getByText('Download destination')).toBeVisible();
  });

  test('keeps page-level vertical scrolling disabled so only the main options pane scrolls', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=integrations`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Site Integrations' })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      rootScrollHeight: document.documentElement.scrollHeight,
      rootClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      bodyClientHeight: document.body.clientHeight,
    }));

    expect(metrics.rootScrollHeight).toBeLessThanOrEqual(metrics.rootClientHeight + 1);
    expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.bodyClientHeight + 1);

    const overflow = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).overflowY,
      body: getComputedStyle(document.body).overflowY,
      appRoot: getComputedStyle(document.getElementById('root')!).overflowY,
      main: getComputedStyle(document.querySelector('main')!).overflowY,
    }));

    expect(overflow.root).toBe('hidden');
    expect(overflow.body).toBe('hidden');
    expect(overflow.appRoot).toBe('hidden');
    expect(overflow.main).toBe('auto');
  });

  test('does not show stale new-indicator history copy in About / Debug', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=debug`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'About / Debug' })).toBeVisible();
    await expect(page.getByText(/Clearing history will reset "New" chapter indicators\./i)).toHaveCount(0);
  });
});
