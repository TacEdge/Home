import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: 'postgres://home_app:home_app@localhost:5432/home_test', BETTER_AUTH_SECRET: 'probe-secret-'.repeat(4),
  BETTER_AUTH_URL: 'https://home.example.test', HOME_ALLOWED_EMAILS: 'sam@example.test', HOME_MAIL_TRANSPORT: 'provider',
  MAIL_API_KEY: 'probe-not-real', MAIL_FROM: 'home@auth.example.test', AUDIT_HASH_SECRET: 'probe-audit-'.repeat(4) };
const srv = spawn('pnpm', ['exec', 'next', 'start', '-p', '3199'], { env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) { try { await fetch('http://127.0.0.1:3199/sign-in'); break; } catch { await sleep(300); } }
try {
  for (const p of ['/sign-in', '/sign-in', '/nothing-here', '/robots.txt', '/icon.svg', '/api/auth/ok']) {
    const r = await fetch('http://127.0.0.1:3199' + p, { redirect: 'manual' });
    const csp = r.headers.get('content-security-policy');
    const html = await r.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
    const unnonced = scripts.filter((s) => !s.includes(`nonce="${nonce}"`));
    console.log(p, r.status, 'nonce', nonce, 'scripts', scripts.length, 'un-nonced', unnonced.length, 'styleTags', (html.match(/<style\b[^>]*>/g) || []).join(' '), 'styleAttrs', (html.match(/ style="/g) || []).length);
    if (p === '/nothing-here') console.log('CSP:', csp, '| xfo', r.headers.get('x-frame-options'), '| hsts', r.headers.get('strict-transport-security'));
  }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const msgs = []; page.on('console', (m) => { if (/Content Security Policy|Refused/i.test(m.text())) msgs.push(m.text()); });
  await page.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await page.goto('http://localhost:3199/sign-in');
  await page.waitForLoadState('networkidle');
  console.log('violations /sign-in', JSON.stringify(await page.evaluate(() => window.__v)), msgs);
  // hydration: React attaches; check a client-only behaviour: the form is interactive and __next_f exists
  console.log('hydrated', await page.evaluate(() => typeof window.__next_f !== 'undefined' && !!document.querySelector('form')));
  // injected script proof
  await page.route('**/sign-in', async (route) => {
    const r = await route.fetch(); let body = await r.text();
    body = body.replace('<body', '<body data-x="1"').replace('</body>', '<script>window.__injected=1</script><img src="x" onerror="window.__injected=2"><a id="js" href="javascript:window.__injected=3">x</a></body>');
    await route.fulfill({ response: r, body });
  });
  await page.goto('http://localhost:3199/sign-in'); await page.waitForLoadState('networkidle');
  await page.click('#js').catch(() => {});
  await sleep(300);
  console.log('injected', await page.evaluate(() => window.__injected), 'violations', JSON.stringify(await page.evaluate(() => window.__v)));
  await browser.close();
} finally { srv.kill('SIGTERM'); await sleep(300); srv.kill('SIGKILL'); }
