/**
 * Standalone entry point — runs the interceptor suite outside Playwright.
 *
 * Usage:
 *   1. Start the app preview server (npm run preview)
 *   2. node message-interceptor/main.mjs
 *
 * For CI-integrated testing use the Playwright spec instead:
 *   npx playwright test security-audit
 */
import { chromium } from 'playwright';
import { analysePayloads } from './techniques/payload-analysis/index.mjs';
import { runMitmTampering } from './techniques/mitm-tampering/index.mjs';
import { runReplayAttack } from './techniques/replay-attack/index.mjs';
import { runSessionHijack } from './techniques/session-hijack/index.mjs';
import { runCryptoBruteforce } from './techniques/crypto-bruteforce/index.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const ICE_TIMEOUT = 20_000;
const CONNECT_TIMEOUT = 30_000;

function log(tag, msg) {
  console.log(`  [${tag}] ${msg}`);
}

async function main() {
  console.log('=== MESSAGE INTERCEPTOR SECURITY SUITE ===\n');
  const browser = await chromium.launch({ headless: true });

  let allPassed = true;
  let inviteCode, answerCode, hostPage;

  // ── Establish a session to capture signaling material ──
  console.log('>>> Establishing a live chat session...');
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  try {
    await hostPage.goto(BASE);
    await hostPage.click('#btn-create');
    await hostPage.fill('#title-input', 'Interceptor Test');
    await hostPage.click('#btn-start-create');

    const inviteEl = hostPage.locator('#invite-code');
    await inviteEl.waitFor({ state: 'visible', timeout: ICE_TIMEOUT });
    // wait for value
    while (!(await inviteEl.inputValue())) await new Promise((r) => setTimeout(r, 200));
    inviteCode = await inviteEl.inputValue();

    await guestPage.goto(BASE);
    await guestPage.click('#btn-join');
    await guestPage.fill('#invite-input', inviteCode);
    await guestPage.click('#btn-accept');

    const answerEl = guestPage.locator('#answer-code');
    await answerEl.waitFor({ state: 'visible', timeout: ICE_TIMEOUT });
    while (!(await answerEl.inputValue())) await new Promise((r) => setTimeout(r, 200));
    answerCode = await answerEl.inputValue();

    await hostPage.fill('#answer-input', answerCode);
    await hostPage.click('#btn-finalize');

    // wait for connected
    await hostPage.locator('.chat-header-status').filter({ hasText: 'Connected' }).waitFor({ timeout: CONNECT_TIMEOUT });
    console.log('>>> Session established.\n');
  } catch (e) {
    console.error('>>> Failed to establish session:', e.message);
    await browser.close();
    process.exit(1);
  }

  // ── 1. Payload Analysis ──
  console.log('>>> Technique: Payload Analysis');
  const pa = analysePayloads({ inviteCode, answerCode });
  pa.findings.forEach((f) => log('Payload', f));
  if (!pa.secure) { allPassed = false; console.error('>>> FAILED\n'); } else { console.log('>>> PASSED\n'); }

  // ── 2. Crypto Brute-Force ──
  console.log('>>> Technique: Crypto Brute-Force');
  const cb = runCryptoBruteforce({ inviteCode, answerCode });
  cb.findings.forEach((f) => log('Crypto', f));
  if (!cb.secure) { allPassed = false; console.error('>>> FAILED\n'); } else { console.log('>>> PASSED\n'); }

  // ── 3. MITM Tampering ──
  console.log('>>> Technique: MITM Tampering');
  const mt = await runMitmTampering({ browser, baseURL: BASE, originalInvite: inviteCode });
  mt.findings.forEach((f) => log('MITM', f));
  if (!mt.secure) { allPassed = false; console.error('>>> FAILED\n'); } else { console.log('>>> PASSED\n'); }

  // ── 4. Replay Attack ──
  console.log('>>> Technique: Replay Attack');
  const ra = await runReplayAttack({ browser, baseURL: BASE, consumedInvite: inviteCode });
  ra.findings.forEach((f) => log('Replay', f));
  if (!ra.secure) { allPassed = false; console.error('>>> FAILED\n'); } else { console.log('>>> PASSED\n'); }

  // ── 5. Session Hijack ──
  console.log('>>> Technique: Session Hijack');
  const sh = await runSessionHijack({ hostPage });
  sh.findings.forEach((f) => log('Hijack', f));
  if (!sh.secure) { allPassed = false; console.error('>>> FAILED\n'); } else { console.log('>>> PASSED\n'); }

  // ── Summary ──
  await hostCtx.close();
  await guestCtx.close();
  await browser.close();

  console.log('=== SUITE COMPLETE ===');
  if (allPassed) {
    console.log('Result: ALL TECHNIQUES PASSED. App resists tested attack vectors.');
    process.exit(0);
  } else {
    console.error('Result: VULNERABILITIES DETECTED. See logs above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
