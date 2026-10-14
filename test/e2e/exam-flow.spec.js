import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN = { email: 'admin@e2e.local', password: 'Admin@12345' };
const shot = (page, name) => page.screenshot({ path: `e2e-screenshots/${name}.png`, fullPage: true });

// Unique per run, because a failed test restarts the worker and module state resets.
function student(tag) {
  const n = String(Date.now() + Math.floor(Math.random() * 1000)).slice(-6);
  return {
    firstName: 'Priya', middleName: tag, lastName: 'Sharma',
    studentId: `IBS${tag.toUpperCase()}${n}`, email: `priya.${tag}${n}@ibs.edu`, phone: `9848${n}`,
  };
}

const CORRECT = { Pragmatic: 'Practical', Ambiguous: 'Vague', Lucrative: 'Profitable', Viable: 'Feasible', Arbitrary: 'Random' };

const appears =(locator) => locator.waitFor({ timeout: 3000 }).then(() => true, () => false);

async function register(page, s) {
  await page.goto('/d/ibs-demo');
  await page.getByLabel('First Name').fill(s.firstName);
  await page.getByLabel('Middle Name').fill(s.middleName);
  await page.getByLabel('Last Name').fill(s.lastName);
  await page.getByLabel('Student ID').fill(s.studentId);
  await page.getByLabel('Email').fill(s.email);
  await page.getByLabel('Phone Number').fill(s.phone);
  await page.getByRole('button', { name: 'Register & Continue' }).click();
  await expect(page.getByRole('heading', { name: /Campus Placement Drive – IBS \(sample\)/ })).toBeVisible();
}

async function startTest(page) {
  const start = page.getByRole('button', { name: 'Start Test' });
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  await expect(page.getByText('Camera is working')).toBeVisible();
  await page.getByLabel(/I have read the instructions/).check();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator('.q-text')).toBeVisible();
}

async function adminLogin(page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Campus drives' })).toBeVisible();
}

test('registration validates the six fields', async ({ page }) => {
  await page.goto('/d/ibs-demo');
  await expect(page.getByRole('heading', { name: 'Candidate Registration' })).toBeVisible();
  await shot(page, '01-registration');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Phone Number').fill('12345');
  await page.getByRole('button', { name: 'Register & Continue' }).click();
  await expect(page.getByText('Enter your first name (letters only).')).toBeVisible();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByText('Enter a valid 10-digit mobile number.')).toBeVisible();
  await shot(page, '02-registration-errors');
});

test('student takes the full test with camera, then admin sees the result and photos', async ({ page, browser }) => {
  const s = student('full');
  await register(page, s);
  await shot(page, '03-instructions');
  await startTest(page);
  await expect(page.locator('.timer')).toHaveText(/^(59|60):\d\d$/);
  await expect(page.locator('.cam-box video')).toBeVisible();
  await shot(page, '04-exam-question');

  // Questions and options are shuffled, so pick answers by text: the 5 synonyms right, the 2 reading questions wrong → 5/7.
  const total = await page.locator('.palette button').count();
  expect(total).toBe(7);
  let sawPassage = false;
  for (let i = 0; i < total; i++) {
    const qText = await page.locator('.q-text').innerText();
    const right = Object.entries(CORRECT).find(([k]) => qText.includes(k))?.[1];
    if (right) await page.locator('.option', { hasText: right }).click();
    else await page.locator('.option', { hasText: /Employee morale|Advocate permanent/ }).click();
    if (await page.locator('.passage').isVisible()) {
      sawPassage = true;
      if (i === total - 1) await shot(page, '05-exam-passage');
    }
    if (i === 2) await page.getByRole('button', { name: 'Mark for review' }).click();
    if (i < total - 1) await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  expect(sawPassage).toBe(true);
  await expect(page.locator('.save-status')).toHaveText('All answers saved');
  await expect(page.locator('.palette button.answered')).toHaveCount(7);

  // Refresh mid-test: answers and timer survive, the camera must be switched back on, and it is not a violation.
  await page.reload();
  await page.getByRole('button', { name: 'Turn camera back on' }).click();
  const fsBack = page.getByRole('button', { name: 'Return to full screen' });
  if (await appears(fsBack)) await fsBack.click();
  await expect(page.locator('.palette button.answered')).toHaveCount(7);
  await expect(page.locator('.violations')).toHaveCount(0);

  await page.waitForTimeout(5000); // let the first camera photo upload
  await page.getByRole('button', { name: 'Submit Test' }).click();
  await expect(page.getByText(/You have answered 7 of 7 questions/)).toBeVisible();
  await shot(page, '06-submit-confirm');
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Test submitted' })).toBeVisible();
  await shot(page, '07-submitted');

  // Reopening the link on this device shows the submitted screen; "Next candidate" starts a fresh registration.
  await page.goto('/d/ibs-demo');
  await expect(page.getByRole('heading', { name: 'Test submitted' })).toBeVisible();
  await page.getByRole('button', { name: /Next candidate/ }).click();
  await expect(page.getByRole('heading', { name: 'Candidate Registration' })).toBeVisible();

  // Re-registering with the same details is refused.
  await page.getByLabel('First Name').fill(s.firstName);
  await page.getByLabel('Last Name').fill(s.lastName);
  await page.getByLabel('Student ID').fill(s.studentId);
  await page.getByLabel('Email').fill(s.email);
  await page.getByLabel('Phone Number').fill(s.phone);
  await page.getByRole('button', { name: 'Register & Continue' }).click();
  await expect(page.getByText('You have already submitted this test.')).toBeVisible();

  // Admin side
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await shot(admin, '08-admin-drives');
  await admin.getByRole('link', { name: 'Campus Placement Drive – IBS' }).click();
  await expect(admin.getByRole('cell', { name: 'Priya full Sharma' })).toBeVisible();
  await shot(admin, '09-admin-monitor');
  await admin.getByRole('tab', { name: 'Results' }).click();
  await expect(admin.locator('tbody tr').first()).toContainText('5/7');
  await shot(admin, '10-admin-results');
  const download = admin.waitForEvent('download');
  await admin.getByRole('button', { name: 'Export to Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/results\.xlsx$/);
  await admin.getByRole('tab', { name: 'Link & QR code' }).click();
  await expect(admin.getByAltText(/QR code for/)).toBeVisible();
  await shot(admin, '11-admin-link-qr');
  await admin.getByRole('tab', { name: 'Results' }).click();
  await admin.getByRole('link', { name: 'Priya full Sharma' }).click();
  await expect(admin.locator('.snap img').first()).toBeVisible();
  await expect(admin.getByText('Started the test')).toBeVisible();
  await shot(admin, '12-admin-candidate');
  await adminCtx.close();
});

test('leaving the test window 3 times auto-submits', async ({ page }) => {
  await register(page, student('cheat'));
  await startTest(page);
  for (let i = 1; i <= 2; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('.alert-warn')).toContainText(`Warning ${i} of 2`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
  await shot(page, '13-violation-warning');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('heading', { name: 'Test submitted' })).toBeVisible();
  await expect(page.getByText(/left the test window too many times/)).toBeVisible();
  await shot(page, '14-auto-submitted');
});

test('turning the camera off blocks the test until it is back on', async ({ page }) => {
  await register(page, student('cam'));
  await startTest(page);
  await page.evaluate(() => document.querySelector('.cam-box video').srcObject.getTracks().forEach((t) => t.stop()));
  await expect(page.getByRole('heading', { name: 'Camera is off' })).toBeVisible();
  await shot(page, '15-camera-off');
  await page.getByRole('button', { name: 'Turn camera back on' }).click();
  await expect(page.getByRole('heading', { name: 'Camera is off' })).toBeHidden();
});

test('a second device is blocked until the coordinator allows re-login', async ({ page, browser }) => {
  const s = student('relogin');
  await register(page, s);
  await startTest(page);
  await page.locator('.option').first().click();
  await expect(page.locator('.save-status')).toHaveText('All answers saved');

  // Same details on a second device → blocked
  const phoneCtx = await browser.newContext({ permissions: ['camera'] });
  const phone = await phoneCtx.newPage();
  const fillDetails = async () => {
    await phone.goto('/d/ibs-demo');
    await phone.getByLabel('First Name').fill(s.firstName);
    await phone.getByLabel('Last Name').fill(s.lastName);
    await phone.getByLabel('Student ID').fill(s.studentId);
    await phone.getByLabel('Email').fill(s.email);
    await phone.getByLabel('Phone Number').fill(s.phone);
    await phone.getByRole('button', { name: 'Register & Continue' }).click();
  };
  await fillDetails();
  await expect(phone.getByText(/already started on another device/)).toBeVisible();
  await shot(phone, '18-relogin-blocked');

  // Coordinator approves from the live monitor
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.getByRole('link', { name: 'Campus Placement Drive – IBS' }).click();
  const request = admin.locator('.relogin-requests li', { hasText: s.studentId });
  await expect(request).toBeVisible();
  await shot(admin, '19-relogin-request');
  await request.getByRole('button', { name: 'Allow re-login' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Allow re-login' }).click();
  await expect(admin.locator('.relogin-requests')).toHaveCount(0);

  // Second device now continues the same test with the saved answer; the first device is logged out.
  await phone.getByRole('button', { name: 'Register & Continue' }).click();
  await phone.getByRole('button', { name: 'Turn camera back on' }).click();
  const fsBack = phone.getByRole('button', { name: 'Return to full screen' });
  if (await appears(fsBack)) await fsBack.click();
  await expect(phone.locator('.palette button.answered')).toHaveCount(1);

  await page.locator('.option').nth(1).click();
  await expect(page.getByText(/opened on another device or browser/)).toBeVisible();
  await adminCtx.close();
  await phoneCtx.close();
});

test('admin creates an exam from Excel and a drive for it', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Exams' }).click();
  await page.getByRole('button', { name: 'New exam' }).click();
  await page.getByLabel('Title').fill('Aptitude – Oct 2026');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Aptitude – Oct 2026' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download template' }).click();
  const file = path.join(os.tmpdir(), `template-${Date.now()}.xlsx`);
  await (await download).saveAs(file);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Imported 3 questions, 2 new sections, 1 passages.')).toBeVisible();
  await expect(page.locator('.q-item')).toHaveCount(3);
  await shot(page, '16-admin-exam-editor');

  const bad = path.join(os.tmpdir(), `bad-${Date.now()}.xlsx`);
  writeFileSync(bad, 'not a spreadsheet');
  await page.locator('input[type="file"]').setInputFiles(bad);
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(/could not be read/)).toBeVisible();

  await page.getByRole('link', { name: 'Drives' }).click();
  await page.getByRole('button', { name: 'New drive' }).click();
  await page.getByRole('textbox', { name: /^College/ }).fill('IBS Hyderabad');
  await page.getByRole('combobox', { name: /^Exam/ }).selectOption({ label: 'Aptitude – Oct 2026 (3 questions, 60 min)' });
  await shot(page, '17-admin-new-drive');
  await page.getByRole('button', { name: 'Save drive' }).click();
  await expect(page.getByRole('heading', { name: /Campus Placement Drive/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Link & QR code' }).click();
  await expect(page.locator('.link-box code').first()).toContainText('/d/ibs-hyderabad-');
  await expect(page.locator('.link-box code').nth(1)).toContainText('/result');
});
