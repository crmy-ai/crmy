// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

const url = process.env.CRMY_UI_URL ?? 'http://localhost:3000/app/';
const email = process.env.CRMY_UI_EMAIL ?? 'sample.admin@crmy.local';
const password = process.env.CRMY_UI_PASSWORD ?? 'crmy-demo-123';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is required for UI smoke tests. Run `npm install` and `npx playwright install chromium`.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return Boolean(root && root.childElementCount > 0);
  }, { timeout: 10_000 });

  const hasLoginForm = await page.getByRole('textbox').count().catch(() => 0);
  if (hasLoginForm > 0) {
    const emailInput = page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
    const passwordInput = page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first();
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }

  const rootText = (await page.locator('#root').innerText({ timeout: 10_000 })).trim();
  if (!rootText) {
    throw new Error('CRMy UI root rendered but contains no visible text.');
  }

  const blank = await page.evaluate(() => {
    const root = document.getElementById('root');
    return !root || root.childElementCount === 0;
  });
  if (blank) {
    throw new Error('CRMy UI root is blank.');
  }

  console.log(`UI smoke passed: ${url}`);
} finally {
  await browser.close();
}
