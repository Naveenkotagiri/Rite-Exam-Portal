import { test, expect } from '@playwright/test';

test('student can register and answer on a phone', async ({ page }) => {
  await page.goto('/d/ibs-demo');
  await page.getByLabel('First Name').fill('Ravi');
  await page.getByLabel('Last Name').fill('Kumar');
  await page.getByLabel('Student ID').fill('IBSMOB01');
  await page.getByLabel('Email').fill('ravi.mobile@ibs.edu');
  await page.getByLabel('Phone Number').fill('9123456780');
  await page.screenshot({ path: 'e2e-screenshots/20-mobile-register.png', fullPage: true });
  await page.getByRole('button', { name: 'Register & Continue' }).click();
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  await page.getByLabel(/I have read the instructions/).check();
  await page.getByRole('button', { name: 'Start Test' }).click();
  const fsBack = page.getByRole('button', { name: 'Return to full screen' });
  if (await fsBack.waitFor({ timeout: 3000 }).then(() => true, () => false)) await fsBack.click();
  await page.locator('.option').nth(1).click();
  await expect(page.locator('.save-status')).toHaveText('All answers saved');
  await page.screenshot({ path: 'e2e-screenshots/21-mobile-exam.png', fullPage: true });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize().width);
});
