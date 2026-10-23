// Browser end-to-end tests: drives the REAL production bundle (Angular, or React with --flavor react) in headless Chromium/Edge against the REAL running
// backend (scripts/run-local.sh). Starts scripts/serve-frontend.mjs itself.
//
// Usage: node tests/e2e/ui-e2e.mjs [--flavor angular|react] [--ui http://localhost:4280] [--shots docs/screenshots] [--out docs/validation/ui-e2e-results.json]
// Environment: BROWSER_BIN (default: Edge on Windows, else chromium/chrome on PATH), LOCAL_DEMO_PASSWORD (default demo-password)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const FLAVOR = opt('--flavor', 'angular');
if (!['angular', 'react'].includes(FLAVOR)) throw new Error('--flavor must be angular or react');
const REACT = FLAVOR === 'react';
const UI = opt('--ui', REACT ? 'http://localhost:4281' : 'http://localhost:4280');
const SHOTS = path.resolve(root, opt('--shots', REACT ? 'docs/screenshots-react' : 'docs/screenshots'));
// the only frontend-specific part of the suite: how to find the form controls
const SEL = REACT
  ? { username: 'input[name="username"]', password: 'input[name="password"]', amount: 'input[name="amount"]', memo: 'input[name="memo"]', target: 'select[name="targetAccountId"]', newTxReady: 'select[name="targetAccountId"]' }
  : { username: 'input[formControlName="username"]', password: 'input[formControlName="password"]', amount: 'input[formControlName="amount"]', memo: 'input[formControlName="memo"]', target: 'mat-select[formControlName="targetAccountId"]', newTxReady: 'app-transaction-new mat-select[formControlName="targetAccountId"]' };
const OUT = opt('--out', null);
const PASSWORD = process.env.LOCAL_DEMO_PASSWORD ?? 'demo-password';
const BROWSER = process.env.BROWSER_BIN ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('No browser found: set BROWSER_BIN');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let scenario = '';
function check(name, ok, evidence = '') {
  results.push({ scenario, check: name, result: ok ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok || !evidence ? '' : '  -> ' + String(evidence).slice(0, 200)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// serve the production bundle (with /api proxy) unless something already listens
let server = null;
async function up() { try { return (await fetch(UI)).ok; } catch { return false; } }
if (!(await up())) {
  server = spawn(process.execPath, [path.join(root, 'scripts', 'serve-frontend.mjs'), '--port', new URL(UI).port || '4280', ...(REACT ? ['--dir', 'frontend-react/dist'] : [])], { stdio: 'ignore' });
  for (let i = 0; i < 30 && !(await up()); i++) await sleep(300);
}

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1366,900'], defaultViewport: { width: 1366, height: 900 } });
const consoleErrors = [];

async function newPage() {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  return page;
}
const text = (page) => page.evaluate(() => document.body.innerText);
async function waitText(page, needle, timeout = 15000) {
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout }, needle);
}
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
async function login(page, username, password = PASSWORD) {
  await page.goto(`${UI}/login`, { waitUntil: 'networkidle0' });
  await page.type(SEL.username, username);
  await page.type(SEL.password, password);
  await page.click('button[type="submit"]');
}
async function pickOption(page, selectSelector, optionText) {
  if (REACT) {
    // native <select>: choose the option whose text contains optionText
    const value = await page.evaluate((sel, t) => {
      const opt = Array.from(document.querySelector(sel).options).find((o) => o.textContent.includes(t));
      if (!opt) throw new Error(`option not found: ${t}`);
      return opt.value;
    }, selectSelector, optionText);
    await page.select(selectSelector, value);
    return;
  }
  await page.click(selectSelector);
  await page.waitForSelector('mat-option');
  await page.evaluate((t) => {
    const opt = Array.from(document.querySelectorAll('mat-option')).find((o) => o.textContent.includes(t));
    if (!opt) throw new Error(`option not found: ${t}`);
    opt.click();
  }, optionText);
  await sleep(150);
}
async function run(name, fn) {
  scenario = name;
  const page = await newPage();
  try { await fn(page); } catch (e) { check('scenario completed without exception', false, e.stack ?? e.message); await shot(page, `failure-${name.replace(/\W+/g, '-')}`).catch(() => undefined); }
  await page.close();
}

await run('sign-in validation and errors', async (page) => {
  await page.goto(`${UI}/login`, { waitUntil: 'networkidle0' });
  await page.click('button[type="submit"]');
  await waitText(page, 'Username is required');
  check('empty form shows field errors and sends nothing', (await text(page)).includes('Password is required'));
  await shot(page, '01-login');
  await page.type(SEL.username, 'alice.customer');
  await page.type(SEL.password, 'wrong-password');
  await page.click('button[type="submit"]');
  await waitText(page, 'Invalid username or password');
  check('wrong password shows a generic error', true);
});

await run('customer journey: portfolio -> deposit -> history', async (page) => {
  await login(page, 'alice.customer');
  await waitText(page, 'My accounts');
  check('customer lands on the portfolio page', true);
  await waitText(page, 'ACC-1000000001'); // the heading renders before the accounts arrive
  check('customer sees own accounts only (ACC-1000000001 yes, ACC-1000000004 no)', (await text(page)).includes('ACC-1000000001') && !(await text(page)).includes('ACC-1000000004'));
  check('navigation hides staff pages', !(await text(page)).includes('Audit trail') && !(await text(page)).includes('Customers'));
  await shot(page, '02-customer-portfolio');

  // navigate INSIDE the app: a full page load would drop the in-memory token (by design)
  await page.evaluate(() => { history.pushState({}, '', '/transactions/new'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector(SEL.newTxReady);
  // the accounts are loaded asynchronously: wait until the target selector actually offers an account
  await page.waitForFunction((sel) => (document.querySelector(sel)?.options?.length ?? 2) > 1, { timeout: 15000 }, SEL.target);
  await pickOption(page, SEL.target, 'ACC-1000000001');
  await page.type(SEL.amount, '12.34');
  await page.type(SEL.memo, 'UI end-to-end deposit');
  await shot(page, '03-new-transaction-form');
  await page.click('button[type="submit"]');
  await waitText(page, 'Accepted');
  const ref = await page.evaluate(() => (document.body.innerText.match(/TXN-[A-Z0-9]{12}/) ?? [null])[0]);
  check('deposit is accepted and shows a reference', !!ref, ref);
  await shot(page, '04-transaction-accepted');

  // client-side validation: an invalid amount never reaches the server
  await page.type(SEL.amount, '1.005');
  await page.click('button[type="submit"]');
  await waitText(page, 'at most 2 decimals');
  check('amount with 3 decimals is blocked client-side', true);

  await page.evaluate(() => { history.pushState({}, '', '/transactions'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitText(page, 'Search and track transaction requests');
  await page.waitForFunction((r) => document.body.innerText.includes(r), { timeout: 20000 }, ref);
  check('the new transaction appears in the history list', true);
  await shot(page, '05-transactions-list');
  await page.evaluate((r) => Array.from(document.querySelectorAll('a')).find((a) => a.textContent.trim() === r)?.click(), ref);
  await waitText(page, 'Details');
  await page.waitForFunction(() => /Completed/.test(document.body.innerText), { timeout: 20000 });
  check('the transaction reaches COMPLETED through the asynchronous pipeline', true);
  await shot(page, '06-transaction-detail');

  // role-based route guard: a customer cannot open staff pages
  await page.evaluate(() => { history.pushState({}, '', '/audit'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitText(page, 'Not permitted');
  check('a customer is redirected from /audit to the not-permitted page', true);
});

await run('operations journey: dashboard, investigations, audit, customers', async (page) => {
  await login(page, 'omar.ops');
  await waitText(page, 'Operations overview');
  await waitText(page, 'Completed (24 h)');
  const t = await text(page);
  check('dashboard shows KPI cards, service health and latency', t.includes('Service health') && t.includes('Processing latency') && t.includes('Transactions by status'));
  await shot(page, '07-ops-dashboard');
  check('operations navigation includes staff pages', t.includes('Investigations') && t.includes('Audit trail') && t.includes('Customers'));

  await page.evaluate(() => { history.pushState({}, '', '/investigations?tab=reconciliation'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitText(page, 'Investigations');
  await sleep(1200);
  await shot(page, '08-investigations');
  check('investigations page renders with tabs', (await text(page)).includes('Pending review'));

  await page.evaluate(() => { history.pushState({}, '', '/audit'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitText(page, 'Immutable record');
  await page.waitForFunction(() => /TRANSACTION_|LOGIN_/.test(document.body.innerText), { timeout: 15000 });
  await shot(page, '09-audit-trail');
  check('audit trail lists events', true);

  await page.evaluate(() => { history.pushState({}, '', '/customers'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitText(page, 'Customers');
  await page.waitForFunction(() => document.body.innerText.includes('CUS-100001'), { timeout: 15000 });
  check('operators see full contact details', (await text(page)).includes('alice@example.test'));
  await shot(page, '10-customers');
});

await run('support agent sees masked PII and no money-movement entry points', async (page) => {
  await login(page, 'sam.support');
  await waitText(page, 'Operations overview');
  check('support navigation has no "New transaction"', !(await text(page)).includes('New transaction'));
  await page.evaluate(() => { history.pushState({}, '', '/customers'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForFunction(() => document.body.innerText.includes('CUS-100001'), { timeout: 15000 });
  const t = await text(page);
  check('e-mail addresses are masked for support', t.includes('a***@example.test') && !t.includes('alice@example.test'));
});

await run('responsive layout', async (page) => {
  await page.setViewport({ width: 390, height: 800 });
  await login(page, 'alice.customer');
  await waitText(page, 'My accounts');
  await waitText(page, 'ACC-1000000001'); // measure the loaded page, not the loading spinner
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('no horizontal page overflow at 390 px wide', !overflow);
  await shot(page, '11-mobile-portfolio');
});

check('no unexpected browser console errors during the run', consoleErrors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, consoleErrors.join(' | '));

await browser.close();
server?.kill();
const pass = results.filter((r) => r.result === 'PASS').length;
const fail = results.length - pass;
console.log(`\n${pass} passed, ${fail} failed, ${results.length} checks (${FLAVOR} UI, browser: ${path.basename(BROWSER)})`);
if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true });
  fs.writeFileSync(path.resolve(root, OUT), JSON.stringify({ ranAt: new Date().toISOString(), flavor: FLAVOR, browser: path.basename(BROWSER), pass, fail, results }, null, 2));
}
process.exit(fail === 0 ? 0 : 1);
