// End-to-end checks of every admin and coordinator feature, through the real UI.
// Setup that is not the point of a test (an exam to use, other candidates) goes through the API.
import { test, expect } from '@playwright/test';

const ADMIN = { email: 'admin@e2e.local', password: 'Admin@12345' };

const uid = () => String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10);
function student(first) {
  const n = uid();
  return { firstName: first, middleName: '', lastName: 'Tester', studentId: `JT${n}`, email: `${first.toLowerCase()}${n}@college.edu`, phone: `97${n}`.slice(0, 10) };
}

async function token(request) {
  const r = await request.post('/api/admin/login', { data: ADMIN });
  return (await r.json()).token;
}

async function call(request, tok, method, url, data) {
  const r = await request.fetch(url, { method, headers: tok ? { Authorization: `Bearer ${tok}` } : {}, data });
  expect(r.ok(), `${method} ${url} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.status() === 204 ? null : r.json();
}

/** Exam "General": Q1 colour of the sky (Red / Blue / Green, Blue correct), Q2 water is wet (Yes / No, Yes correct). */
async function examAndDrive(request, tok, { durationMin = 30, drive = {} } = {}) {
  const exam = await call(request, tok, 'POST', '/api/admin/exams', { title: `Journey exam ${uid()}`, durationMin });
  const sec = await call(request, tok, 'POST', `/api/admin/exams/${exam.id}/sections`, { name: 'General' });
  await call(request, tok, 'POST', `/api/admin/exams/${exam.id}/questions`, { sectionId: sec.id, text: 'Colour of a clear sky?', options: ['Red', 'Blue', 'Green'], correctIndex: 1 });
  await call(request, tok, 'POST', `/api/admin/exams/${exam.id}/questions`, { sectionId: sec.id, text: 'Is water wet?', options: ['Yes', 'No'], correctIndex: 0 });
  const d = await call(request, tok, 'POST', '/api/admin/drives', {
    name: 'Journey drive', college: `Journey College ${uid()}`, examId: exam.id, code: `jt-${uid()}`,
    cameraRequired: false, requireFullscreen: false, maxViolations: 0, shuffleQuestions: false, shuffleOptions: false, ...drive,
  });
  return { exam, drive: d };
}

async function adminLogin(page, creds = ADMIN) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Campus drives' })).toBeVisible();
}

async function fillRegistration(page, code, s) {
  await page.goto(`/d/${code}`);
  await page.getByLabel('First Name').fill(s.firstName);
  await page.getByLabel('Last Name').fill(s.lastName);
  await page.getByLabel('Student ID').fill(s.studentId);
  await page.getByLabel('Email').fill(s.email);
  await page.getByLabel('Phone Number').fill(s.phone);
  await page.getByRole('button', { name: 'Register & Continue' }).click();
}

async function startWithoutCamera(page) {
  await page.getByLabel(/I have read the instructions/).check();
  await page.getByRole('button', { name: 'Start Test' }).click();
  await expect(page.locator('.q-text')).toBeVisible();
}

/** Registers, starts and answers through the API. `picks` = option text per question, in paper order. */
async function apiCandidate(request, code, s, picks, submit = true) {
  const { token: t } = await call(request, null, 'POST', `/api/drives/${code}/register`, s);
  const state = await call(request, t, 'POST', '/api/attempt/start');
  const answers = state.questions.map((q, i) => ({ questionId: q.id, selected: q.options.find((o) => o.text === picks[i]).key }));
  await call(request, t, 'POST', '/api/attempt/answers', { answers });
  if (submit) await call(request, t, 'POST', '/api/attempt/submit');
  return t;
}

const shot = (page, name) => page.screenshot({ path: `e2e-screenshots/${name}.png`, fullPage: true });

test('admin users: add one, log in as them, change password, remove them', async ({ page, browser }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Admins' }).click();
  const n = uid();
  const colleague = { email: `hr${n}@rite.test`, password: 'Temp@12345' };
  await page.getByRole('textbox', { name: /^Name/ }).fill('HR Colleague');
  await page.getByRole('textbox', { name: /^Email/ }).fill(colleague.email);
  await page.getByRole('textbox', { name: /^Temporary password/ }).fill(colleague.password);
  await page.getByRole('button', { name: 'Add admin' }).click();
  await expect(page.getByText(`${colleague.email} can now log in`)).toBeVisible();
  await shot(page, '30-admins');

  const ctx = await browser.newContext();
  const hr = await ctx.newPage();
  await adminLogin(hr, colleague);
  await hr.getByRole('link', { name: 'Admins' }).click();
  await hr.getByLabel('Current password').fill(colleague.password);
  await hr.getByLabel('New password').fill('Changed@12345');
  await hr.getByRole('button', { name: 'Change password' }).click();
  await expect(hr.getByText('Password changed.')).toBeVisible();
  await hr.getByRole('button', { name: 'Log out' }).click();
  // Wait for the login page: the Admins page being left also has an "Email" box.
  await expect(hr.getByRole('heading', { name: 'Admin login' })).toBeVisible();
  await hr.getByLabel('Email').fill(colleague.email);
  await hr.getByLabel('Password').fill(colleague.password);
  await hr.getByRole('button', { name: 'Log in' }).click();
  await expect(hr.getByText('Incorrect email or password.')).toBeVisible();
  await adminLogin(hr, { email: colleague.email, password: 'Changed@12345' });
  await ctx.close();

  page.once('dialog', (d) => d.accept());
  await page.locator('tr', { hasText: colleague.email }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('tr', { hasText: colleague.email })).toHaveCount(0);
});

test('exam editor by hand: sections, passage, questions, validation, edit, delete, reorder, export, duplicate', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Exams' }).click();
  await page.getByRole('button', { name: 'New exam' }).click();
  const title = `Manual exam ${uid()}`;
  await page.getByRole('dialog').getByLabel(/^Title/).fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  for (const name of ['Aptitude', 'Verbal']) {
    await page.getByRole('button', { name: 'Add section' }).click();
    await page.getByRole('dialog').getByLabel(/^Section name/).fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const sectionRows = page.locator('.card', { has: page.getByRole('heading', { name: 'Sections' }) }).locator('tbody tr');
  await expect(sectionRows.first()).toContainText('Aptitude');
  await sectionRows.nth(1).getByRole('button', { name: 'Move up' }).click();
  await expect(sectionRows.first()).toContainText('Verbal');

  await page.getByRole('button', { name: 'Add passage' }).click();
  await page.getByRole('dialog').getByLabel(/^Title/).fill('Story');
  await page.getByRole('dialog').getByLabel(/^Passage text/).fill('Ravi planted a tree. Ten years later it gave shade to the whole street.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Question without a correct answer is refused; then saved properly.
  await page.getByRole('button', { name: 'Add question' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: /^Section/ }).selectOption({ label: 'Aptitude' });
  await dlg.getByRole('textbox', { name: /^Question/ }).fill('What is 2 + 2?');
  await dlg.getByPlaceholder('Required').nth(0).fill('4');
  await dlg.getByPlaceholder('Required').nth(1).fill('5');
  await dlg.getByRole('button', { name: 'Save question' }).click();
  await expect(dlg.getByText(/Correct answer is required|Choose which option is correct/).first()).toBeVisible();
  await dlg.getByLabel('Option A is correct').check();
  await dlg.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const items = page.locator('.q-item');
  await expect(items).toHaveCount(1);
  await expect(items.first().locator('li.correct')).toContainText('4');

  // Edit: change the correct answer to B.
  await items.first().getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Option B is correct').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save question' }).click();
  await expect(items.first().locator('li.correct')).toContainText('5');

  // A passage question in the other section.
  await page.getByRole('button', { name: 'Add question' }).click();
  await dlg.getByRole('combobox', { name: /^Section/ }).selectOption({ label: 'Verbal' });
  await dlg.getByRole('combobox', { name: /^Passage/ }).selectOption({ label: 'Story' });
  await dlg.getByRole('textbox', { name: /^Question/ }).fill('Who planted the tree?');
  await dlg.getByPlaceholder('Required').nth(0).fill('Ravi');
  await dlg.getByPlaceholder('Required').nth(1).fill('Sita');
  await dlg.getByLabel('Option A is correct').check();
  await dlg.getByRole('button', { name: 'Save question' }).click();
  await expect(items).toHaveCount(2);
  await expect(page.locator('.q-item', { hasText: 'Who planted' })).toContainText('Passage: Story');
  await shot(page, '31-exam-editor-manual');

  // Delete the first question.
  page.once('dialog', (d) => d.accept());
  await page.locator('.q-item', { hasText: '2 + 2' }).getByRole('button', { name: 'Delete' }).click();
  await expect(items).toHaveCount(1);

  // Export and duplicate.
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current questions' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByRole('link', { name: 'Exams' }).first().click();
  await page.locator('tr', { hasText: title }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: `${title} (copy)` })).toBeVisible();
  await expect(page.locator('.q-item')).toHaveCount(1);
});

test('drive times: not open yet, then open, closed, reopened', async ({ page, browser, request }) => {
  const tok = await token(request);
  const { drive } = await examAndDrive(request, tok, { drive: { opensAt: new Date(Date.now() + 2 * 3600_000).toISOString() } });

  const s1 = student('Early');
  await fillRegistration(page, drive.code, s1);
  await expect(page.getByText(/This test opens at/)).toBeVisible();
  await expect(page.getByText('This test has not opened yet. Please wait for the coordinator to start it.')).toBeVisible();
  await shot(page, '32-not-open-yet');

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto(`/admin/drives/${drive.id}`);
  await expect(admin.locator('.page-header .badge')).toHaveText('Not open yet');
  await admin.getByRole('button', { name: 'Edit' }).click();
  await admin.getByLabel('Opens at').fill('');
  await admin.getByRole('button', { name: 'Save drive' }).click();
  await expect(admin.locator('.page-header .badge')).toHaveText('Open');

  await page.getByRole('button', { name: 'Register & Continue' }).click();
  await expect(page.getByRole('button', { name: 'Start Test' })).toBeVisible();

  await admin.getByRole('button', { name: 'Close test' }).click();
  await expect(admin.locator('.page-header .badge')).toHaveText('Closed');

  // A new student cannot register; the registered one cannot start.
  const other = await adminCtx.newPage();
  await fillRegistration(other, drive.code, student('Late'));
  await expect(other.getByText('This test is closed and is no longer accepting candidates.').last()).toBeVisible();
  await page.getByLabel(/I have read the instructions/).check();
  await page.getByRole('button', { name: 'Start Test' }).click();
  await expect(page.getByText(/This test is closed/)).toBeVisible();

  await admin.getByRole('button', { name: 'Open test' }).click();
  await expect(admin.locator('.page-header .badge')).toHaveText('Open');
  await page.getByRole('button', { name: 'Start Test' }).click();
  await expect(page.locator('.q-text')).toBeVisible();
  await adminCtx.close();
});

test('time runs out: the test submits itself and results say Time up', async ({ page, browser, request }) => {
  test.setTimeout(200_000);
  const tok = await token(request);
  const { drive } = await examAndDrive(request, tok, { durationMin: 1 });
  const s = student('Slow');
  await fillRegistration(page, drive.code, s);
  await startWithoutCamera(page);
  await page.locator('.option', { hasText: 'Blue' }).click();
  await expect(page.locator('.save-status')).toHaveText('All answers saved');
  await expect(page.getByRole('heading', { name: 'Test submitted' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Time is up, so your test was submitted automatically.')).toBeVisible();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto(`/admin/drives/${drive.id}?tab=results`);
  const row = admin.locator('tbody tr', { hasText: s.studentId });
  await expect(row).toContainText('1/2');
  await expect(row).toContainText('Time up');
  await adminCtx.close();
});

test('coordinator adds 5 minutes and later submits the test; the student sees both', async ({ page, browser, request }) => {
  test.setTimeout(150_000);
  const tok = await token(request);
  const { drive } = await examAndDrive(request, tok, { durationMin: 30 });
  const s = student('Helped');
  await fillRegistration(page, drive.code, s);
  await startWithoutCamera(page);
  const minutes = async () => Number((await page.locator('.timer').innerText()).trim().split(':')[0]);
  expect(await minutes()).toBeLessThanOrEqual(30);

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto(`/admin/drives/${drive.id}`);
  const row = admin.locator('tbody tr', { hasText: s.studentId });
  await row.getByRole('button', { name: '+5 min' }).click();
  await expect.poll(minutes, { timeout: 25_000 }).toBeGreaterThanOrEqual(34);

  await row.getByRole('button', { name: 'Submit' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Submit test' }).click();
  await expect(page.getByText('Your test was submitted by the coordinator.')).toBeVisible({ timeout: 25_000 });
  await adminCtx.close();
});

test('internet drops: answers wait on the device and save when it is back', async ({ page, context, request }) => {
  const tok = await token(request);
  const { drive } = await examAndDrive(request, tok);
  const s = student('Offline');
  await fillRegistration(page, drive.code, s);
  await startWithoutCamera(page);

  await context.setOffline(true);
  await page.locator('.option', { hasText: 'Blue' }).click();
  await expect(page.locator('.save-status')).toHaveText('Offline – will save when connected', { timeout: 15_000 });
  await shot(page, '33-offline');
  await context.setOffline(false);
  await expect(page.locator('.save-status')).toHaveText('All answers saved', { timeout: 15_000 });

  const list = await call(request, tok, 'GET', `/api/admin/drives/${drive.id}/attempts`);
  expect(list.attempts.find((a) => a.student_code === s.studentId).answered).toBe(1);
});

test('results: shortlist cutoff, re-grade after fixing the key, delete a candidate who can then register again', async ({ page, request }) => {
  const tok = await token(request);
  const { exam, drive } = await examAndDrive(request, tok);
  const asha = student('Asha');
  const bala = student('Bala');
  await apiCandidate(request, drive.code, asha, ['Blue', 'Yes']); // 2/2
  await apiCandidate(request, drive.code, bala, ['Red', 'Yes']); // 1/2

  await adminLogin(page);
  await page.goto(`/admin/drives/${drive.id}?tab=results`);
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Asha');
  await expect(rows.first()).toContainText('2/2');
  await page.getByLabel(/Shortlist: score at least/).fill('60');
  await expect(rows).toHaveCount(1);
  await page.getByLabel(/Shortlist: score at least/).fill('');

  // The key for Q1 was wrong: Red is "correct". Fix it in the editor, then re-grade.
  await page.goto(`/admin/exams/${exam.id}`);
  await page.locator('.q-item', { hasText: 'clear sky' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Option A is correct').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save question' }).click();
  await expect(page.locator('.q-item', { hasText: 'clear sky' }).locator('li.correct')).toContainText('Red');
  await page.goto(`/admin/drives/${drive.id}?tab=results`);
  await page.getByRole('button', { name: 'Re-grade' }).click();
  await expect(page.getByText('Re-graded 2 submitted tests with the current answer key.')).toBeVisible();
  await expect(rows.first()).toContainText('Bala');
  await expect(rows.first()).toContainText('2/2');
  await shot(page, '34-results-regraded');

  // Delete Asha; she can register again.
  await rows.filter({ hasText: 'Asha' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Delete candidate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('tab', { name: 'Live monitor' })).toBeVisible();
  await expect(page.locator('tbody tr', { hasText: asha.studentId })).toHaveCount(0);
  await call(request, null, 'POST', `/api/drives/${drive.code}/register`, asha);
});

test('HR publishes results; students check them on the drive link and see no marks', async ({ page, browser, request }) => {
  const tok = await token(request);
  const { drive } = await examAndDrive(request, tok);
  const top = student('Kiran');
  const low = student('Meena');
  await apiCandidate(request, drive.code, top, ['Blue', 'Yes']); // 100%
  await apiCandidate(request, drive.code, low, ['Red', 'Yes']); // 50%

  // Before publishing, students are told to wait.
  await page.goto(`/d/${drive.code}/result`);
  await expect(page.getByRole('heading', { name: 'Results are not out yet' })).toBeVisible();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto(`/admin/drives/${drive.id}?tab=results`);
  await admin.getByLabel(/Shortlist: score at least/).fill('60');
  await expect(admin.getByText('1 of 2 submitted would be shortlisted')).toBeVisible();
  await admin.getByLabel(/Message for shortlisted candidates/).fill('Interview on 20 Oct at 10:00 am, Rite office Hyderabad.\nBring your college ID.');
  await admin.getByRole('button', { name: 'Publish results' }).click();
  await expect(admin.getByRole('dialog')).toContainText('1 candidates will see Shortlisted and 1 will see Not selected');
  await admin.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText(/Results published/)).toBeVisible();
  await expect(admin.locator('tbody tr', { hasText: 'Kiran' })).toContainText('Shortlisted');
  await expect(admin.locator('tbody tr', { hasText: 'Meena' })).toContainText('Not selected');
  await shot(admin, '36-results-published');

  // Students check: the registration page points to results; the shortlisted one sees next steps, no marks.
  await page.goto(`/d/${drive.code}`);
  await page.getByRole('link', { name: 'Check my result' }).click();
  await page.getByLabel('Student ID').fill(top.studentId.toLowerCase());
  await page.getByLabel('Phone Number').fill(`+91 ${top.phone}`);
  await page.getByRole('button', { name: 'Check result' }).click();
  await expect(page.getByRole('heading', { name: `Congratulations, ${top.firstName}. You are shortlisted.` })).toBeVisible();
  await expect(page.getByText('Interview on 20 Oct at 10:00 am')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('%');
  await shot(page, '37-student-shortlisted');

  await page.getByRole('button', { name: 'Check another result' }).click();
  await page.getByLabel('Student ID').fill(low.studentId);
  await page.getByLabel('Phone Number').fill('9000000001');
  await page.getByRole('button', { name: 'Check result' }).click();
  await expect(page.getByText(/No registration matches/)).toBeVisible();
  await page.getByLabel('Phone Number').fill(low.phone);
  await page.getByRole('button', { name: 'Check result' }).click();
  await expect(page.getByRole('heading', { name: `Thank you, ${low.firstName}.` })).toBeVisible();
  await expect(page.getByText(/not been shortlisted this time/)).toBeVisible();

  // HR moves Meena into the shortlist by hand; she now sees Shortlisted.
  await admin.locator('tbody tr', { hasText: 'Meena' }).getByRole('button', { name: 'Add to shortlist' }).click();
  await expect(admin.locator('tbody tr', { hasText: 'Meena' })).toContainText('changed by hand');
  await page.getByRole('button', { name: 'Check another result' }).click();
  await page.getByLabel('Student ID').fill(low.studentId);
  await page.getByLabel('Phone Number').fill(low.phone);
  await page.getByRole('button', { name: 'Check result' }).click();
  await expect(page.getByRole('heading', { name: /You are shortlisted/ })).toBeVisible();

  // Unpublish hides results again.
  await admin.getByRole('button', { name: 'Unpublish' }).click();
  await expect(admin.getByRole('button', { name: 'Publish results' })).toBeVisible();
  await page.goto(`/d/${drive.code}/result`);
  await expect(page.getByRole('heading', { name: 'Results are not out yet' })).toBeVisible();
  await adminCtx.close();
});

test('duplicate details are refused on the registration form', async ({ page, request }) => {
  const tok = await token(request);
  const { drive } = await examAndDrive(request, tok);
  const first = student('First');
  await call(request, null, 'POST', `/api/drives/${drive.code}/register`, first);
  await fillRegistration(page, drive.code, { ...student('Second'), email: first.email, phone: first.phone });
  await expect(page.getByText('This email is already registered for this test.')).toBeVisible();
  await expect(page.getByText('This phone number is already registered for this test.')).toBeVisible();
});

test('during the test: right-click is blocked and leaving full screen pauses the test', async ({ page }) => {
  await page.goto('/d/ibs-demo');
  const s = student('Rules');
  await fillRegistration(page, 'ibs-demo', s);
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  await page.getByLabel(/I have read the instructions/).check();
  await page.getByRole('button', { name: 'Start Test' }).click();
  await expect(page.locator('.q-text')).toBeVisible();
  const fsBack = page.getByRole('button', { name: 'Return to full screen' });
  if (await fsBack.isVisible()) await fsBack.click();

  const blocked = await page.evaluate(() => !document.querySelector('.q-text').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(blocked).toBe(true);

  const fsWorks = await page.evaluate(() => Boolean(document.fullscreenElement));
  test.skip(!fsWorks, 'this browser did not enter full screen');
  await page.evaluate(() => document.exitFullscreen());
  await expect(fsBack).toBeVisible();
  await shot(page, '35-fullscreen-overlay');
  await fsBack.click();
  await expect(fsBack).toBeHidden();
});
