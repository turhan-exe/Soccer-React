import { test, expect } from '@playwright/test';

test('fixtures page renders header', async ({ page }) => {
  await page.goto('/fixtures');
  const title = page.locator('h1');
  await expect(title).toContainText(/Fikst/i);
});

test('standings page renders header', async ({ page }) => {
  await page.goto('/standings');
  const title = page.locator('h1');
  await expect(title).toContainText(/Puan/i);
});

test('match watcher basic render', async ({ page }) => {
  // Does not require data; page should render a header indicating mode
  await page.goto('/match/M001');
  const header = page.locator('h1.text-xl.font-bold');
  await expect(header.first()).toBeVisible();
});

