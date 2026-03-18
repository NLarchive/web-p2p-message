import { test, expect } from '@playwright/test';
import { analysePayloads } from '../../message-interceptor/techniques/payload-analysis/index.mjs';
import { runMitmTampering } from '../../message-interceptor/techniques/mitm-tampering/index.mjs';
import { runReplayAttack } from '../../message-interceptor/techniques/replay-attack/index.mjs';
import { runSessionHijack } from '../../message-interceptor/techniques/session-hijack/index.mjs';
import { runCryptoBruteforce } from '../../message-interceptor/techniques/crypto-bruteforce/index.mjs';

// ─── Timeouts ────────────────────────────────────────────────────────────────
const ICE_TIMEOUT = 20_000;
const CONNECT_TIMEOUT = 30_000;
const MSG_TIMEOUT = 10_000;
const NUM_PAIRS = 3; // number of simultaneous chat pairs

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Establish a full chat session between two fresh browser contexts.
 * Returns the raw signaling material (invite + answer codes) so the
 * interceptor can analyse / replay / tamper with them.
 */
async function establishPair(browser, baseURL, label) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  // Host creates
  await hostPage.goto(baseURL);
  await hostPage.click('#btn-create');
  await hostPage.fill('#title-input', label);
  await hostPage.click('#btn-start-create');

  const inviteLocator = hostPage.locator('#invite-code');
  await expect(inviteLocator).not.toHaveValue('', { timeout: ICE_TIMEOUT });
  const inviteCode = await inviteLocator.inputValue();

  // Guest joins
  await guestPage.goto(baseURL);
  await guestPage.click('#btn-join');
  await guestPage.fill('#invite-input', inviteCode);
  await guestPage.click('#btn-accept');

  const answerLocator = guestPage.locator('#answer-code');
  await expect(answerLocator).toBeVisible({ timeout: ICE_TIMEOUT });
  await expect(answerLocator).not.toHaveValue('', { timeout: ICE_TIMEOUT });
  const answerCode = await answerLocator.inputValue();

  // Finalise handshake
  await hostPage.fill('#answer-input', answerCode);
  await hostPage.click('#btn-finalize');

  // Wait for connection
  await expect(hostPage.locator('.chat-header-status')).toContainText(
    'Connected',
    { timeout: CONNECT_TIMEOUT },
  );
  await expect(guestPage.locator('.chat-header-status')).toContainText(
    'Connected',
    { timeout: CONNECT_TIMEOUT },
  );

  return { hostCtx, guestCtx, hostPage, guestPage, inviteCode, answerCode };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Security Audit — multi-session interception', () => {
  // Shared state across the describe block — populated by the first test.
  /** @type {{ hostCtx: any, guestCtx: any, hostPage: any, guestPage: any, inviteCode: string, answerCode: string }[]} */
  let pairs = [];

  test.afterAll(async () => {
    for (const p of pairs) {
      await p.hostCtx.close().catch(() => {});
      await p.guestCtx.close().catch(() => {});
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // 1. Establish N independent chat pairs and exchange messages
  // ────────────────────────────────────────────────────────────────────────
  test(`establish ${NUM_PAIRS} independent chat pairs and exchange messages`, async ({
    browser,
  }) => {
    const baseURL =
      process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';

    for (let i = 0; i < NUM_PAIRS; i++) {
      const pair = await establishPair(browser, baseURL, `Pair-${i + 1}`);
      pairs.push(pair);

      // Host → Guest
      await pair.hostPage.fill('#msg-input', `Secret-H${i + 1}`);
      await pair.hostPage.click('#btn-send');
      await expect(pair.guestPage.locator('#msg-list li')).toHaveCount(1, {
        timeout: MSG_TIMEOUT,
      });
      await expect(
        pair.guestPage.locator('#msg-list li').first(),
      ).toContainText(`Secret-H${i + 1}`);

      // Guest → Host
      await pair.guestPage.fill('#msg-input', `Secret-G${i + 1}`);
      await pair.guestPage.click('#btn-send');
      await expect(pair.hostPage.locator('#msg-list li')).toHaveCount(2, {
        timeout: MSG_TIMEOUT,
      });
      await expect(
        pair.hostPage.locator('#msg-list li').nth(1),
      ).toContainText(`Secret-G${i + 1}`);
    }

    // Sanity: all pairs connected and exchanged messages
    expect(pairs).toHaveLength(NUM_PAIRS);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Payload Analysis — passive sniffing on every captured payload
  // ────────────────────────────────────────────────────────────────────────
  test('intercepted payloads do not leak private key material', async () => {
    test.skip(pairs.length === 0, 'No pairs established');
    for (const p of pairs) {
      const { secure, findings } = analysePayloads({
        inviteCode: p.inviteCode,
        answerCode: p.answerCode,
      });
      for (const f of findings) console.log(`  [Payload] ${f}`);
      expect(secure).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Crypto Brute-Force — verify PQ parameter sizes
  // ────────────────────────────────────────────────────────────────────────
  test('captured crypto parameters are PQ-strength', async () => {
    test.skip(pairs.length === 0, 'No pairs established');
    for (const p of pairs) {
      const { secure, findings } = runCryptoBruteforce({
        inviteCode: p.inviteCode,
        answerCode: p.answerCode,
      });
      for (const f of findings) console.log(`  [Crypto] ${f}`);
      expect(secure).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. MITM Tampering — corrupt a payload and try to connect
  // ────────────────────────────────────────────────────────────────────────
  test('tampered invite is rejected or connection fails', async ({
    browser,
  }) => {
    test.skip(pairs.length === 0, 'No pairs established');
    const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
    const { secure, findings } = await runMitmTampering({
      browser,
      baseURL,
      originalInvite: pairs[0].inviteCode,
    });
    for (const f of findings) console.log(`  [MITM] ${f}`);
    expect(secure).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Replay Attack — reuse a consumed invite
  // ────────────────────────────────────────────────────────────────────────
  test('replayed invite does not establish a new session', async ({
    browser,
  }) => {
    test.skip(pairs.length === 0, 'No pairs established');
    const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
    const { secure, findings } = await runReplayAttack({
      browser,
      baseURL,
      consumedInvite: pairs[0].inviteCode,
    });
    for (const f of findings) console.log(`  [Replay] ${f}`);
    expect(secure).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Session Hijack — probe the connected host for leaked secrets
  // ────────────────────────────────────────────────────────────────────────
  test('connected session does not leak secrets to page scope', async () => {
    test.skip(pairs.length === 0, 'No pairs established');
    const { secure, findings } = await runSessionHijack({
      hostPage: pairs[0].hostPage,
    });
    for (const f of findings) console.log(`  [Hijack] ${f}`);
    expect(secure).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 7. Cross-pair isolation — messages from pair A are not visible in pair B
  // ────────────────────────────────────────────────────────────────────────
  test('messages are isolated across independent sessions', async () => {
    test.skip(pairs.length < 2, 'Need at least 2 pairs');
    // Pair 0's guest should NOT see messages from Pair 1
    const pair0Msgs = await pairs[0].guestPage.evaluate(() =>
      Array.from(document.querySelectorAll('#msg-list li')).map((li) => li.textContent),
    );
    const pair1Msgs = await pairs[1].guestPage.evaluate(() =>
      Array.from(document.querySelectorAll('#msg-list li')).map((li) => li.textContent),
    );
    // Pair 0 should only contain pair 0's messages
    for (const m of pair0Msgs) {
      expect(m).not.toContain('Secret-H2');
      expect(m).not.toContain('Secret-G2');
    }
    for (const m of pair1Msgs) {
      expect(m).not.toContain('Secret-H1');
      expect(m).not.toContain('Secret-G1');
    }
  });
});
