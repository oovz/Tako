// Small UI helpers shared by options-related tests to avoid duplication
import { expect, Page } from '@playwright/test'

export async function robustSelect(page: Page, triggerSelector: string, optionName: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator(triggerSelector).click({ force: true });
    const option = page.getByRole('option', { name: optionName }).first();
    try { await option.waitFor({ state: 'visible', timeout: 3000 }); } catch { if (attempt === 2) throw new Error(`Option '${optionName}' not visible for ${triggerSelector}`); continue; }
    await option.click({ force: true });
    await page.waitForTimeout(100);
    return;
  }
}

export async function ensureSwitchState(page: Page, selector: string, shouldBeOn: boolean) {
  const el = page.locator(selector);
  await expect(el).toBeVisible();
  const state = (await el.getAttribute('data-state')) || 'unchecked';
  const isOn = state === 'checked';
  if (isOn !== shouldBeOn) {
    await el.scrollIntoViewIfNeeded();
    await el.click({ force: true });
    await expect(el).toHaveAttribute('data-state', shouldBeOn ? 'checked' : 'unchecked');
  }
}
