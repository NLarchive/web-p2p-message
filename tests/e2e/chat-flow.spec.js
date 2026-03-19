import { test, expect } from '@playwright/test';

// ICE gathering can take up to 5 s per peer, DTLS handshake adds more.
// We give generous timeouts so the test is not flaky on slow CI machines.
const ICE_TIMEOUT = 20_000;
const CONNECT_TIMEOUT = 30_000;
const MSG_TIMEOUT = 10_000;

test.describe('P2P chat — two peers', () => {
  test('connect and exchange messages in both directions', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();

    try {
      const hostPage = await hostCtx.newPage();
      const guestPage = await guestCtx.newPage();

      // ── 1. Host creates a session ─────────────────────────────────────────
      await hostPage.goto('/');
      await expect(hostPage.locator('h1')).toHaveText('P2P Message');
      await hostPage.click('#btn-create');

      // Fill optional title and create
      await hostPage.fill('#title-input', 'Test Chat');
      await hostPage.click('#btn-start-create');

      // Wait for invite-code textarea to contain a value (ICE gathering).
      const inviteCodeLocator = hostPage.locator('#invite-code');
      await expect(inviteCodeLocator).not.toHaveValue('', {
        timeout: ICE_TIMEOUT,
      });
      const inviteCode = await inviteCodeLocator.inputValue();
      expect(inviteCode.length).toBeGreaterThan(20);

      // ── 2. Guest joins with the invite code ───────────────────────────────
      await guestPage.goto('/');
      await guestPage.click('#btn-join');
      await guestPage.fill('#invite-input', inviteCode);
      await guestPage.click('#btn-accept');

      // Wait for answer-code textarea to appear (ICE gathering on guest side).
      const answerCodeLocator = guestPage.locator('#answer-code');
      await expect(answerCodeLocator).toBeVisible({ timeout: ICE_TIMEOUT });
      await expect(answerCodeLocator).not.toHaveValue('', {
        timeout: ICE_TIMEOUT,
      });
      const answerCode = await answerCodeLocator.inputValue();
      expect(answerCode.length).toBeGreaterThan(20);

      // ── 3. Host finalises the handshake ───────────────────────────────────
      await hostPage.fill('#answer-input', answerCode);
      await hostPage.click('#btn-finalize');

      // ── 4. Both peers reach the connected chat screen ─────────────────────
      await expect(hostPage.locator('.chat-header-status')).toContainText('Connected', {
        timeout: CONNECT_TIMEOUT,
      });
      await expect(guestPage.locator('.chat-header-status')).toContainText('Connected', {
        timeout: CONNECT_TIMEOUT,
      });

      // ── 5. Host sends a message ───────────────────────────────────────────
      await hostPage.fill('#msg-input', 'Hello from host!');
      await hostPage.click('#btn-send');

      await expect(hostPage.locator('#msg-list li')).toHaveCount(1, {
        timeout: MSG_TIMEOUT,
      });
      await expect(
        hostPage.locator('#msg-list li').first(),
      ).toContainText('Hello from host!');

      // ── 6. Guest receives the host's message ──────────────────────────────
      await expect(guestPage.locator('#msg-list li')).toHaveCount(1, {
        timeout: MSG_TIMEOUT,
      });
      await expect(
        guestPage.locator('#msg-list li').first(),
      ).toContainText('Hello from host!');

      // ── 7. Guest replies ──────────────────────────────────────────────────
      await guestPage.fill('#msg-input', 'Hello from guest!');
      await guestPage.click('#btn-send');

      await expect(guestPage.locator('#msg-list li')).toHaveCount(2, {
        timeout: MSG_TIMEOUT,
      });
      await expect(
        guestPage.locator('#msg-list li').nth(1),
      ).toContainText('Hello from guest!');

      // ── 8. Host receives the reply ────────────────────────────────────────
      await expect(hostPage.locator('#msg-list li')).toHaveCount(2, {
        timeout: MSG_TIMEOUT,
      });
      await expect(
        hostPage.locator('#msg-list li').nth(1),
      ).toContainText('Hello from guest!');

      // ── 9. Fingerprints are displayed ─────────────────────────────────────
      const hostFingerprints = await hostPage.locator('.fingerprint').all();
      const guestFingerprints = await guestPage.locator('.fingerprint').all();
      expect(hostFingerprints.length).toBe(2);
      expect(guestFingerprints.length).toBe(2);

      const hostLocalFp = await hostFingerprints[0].textContent();
      const guestRemoteFp = await guestFingerprints[1].textContent();
      expect(hostLocalFp).toBeTruthy();
      // Host's local fingerprint should equal guest's remote fingerprint.
      expect(hostLocalFp).toBe(guestRemoteFp);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('expired invite is rejected with a clear error', async ({ browser }) => {
    const { encodeJson } = await import('../../src/shared/encoding/base64url.js');
    const expiredCode = encodeJson({
      s: { type: 'offer', sdp: 'v=0' },
      k: { kty: 'EC', crv: 'P-256', x: 'fake', y: 'data' },
      i: 'session-expired',
      t: Date.now() - 600_000, // 10 minutes ago
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      await page.click('#btn-join');
      await page.fill('#invite-input', expiredCode);
      await page.click('#btn-accept');
      await expect(page.locator('.toast-error')).toContainText('expired', {
        timeout: 5000,
      });
    } finally {
      await ctx.close();
    }
  });

  test('garbage invite code is rejected with a clear error', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      await page.click('#btn-join');
      await page.fill('#invite-input', 'this-is-not-a-valid-base64url-code');
      await page.click('#btn-accept');
      await expect(page.locator('.toast-error')).toContainText('decode', {
        timeout: 5000,
      });
    } finally {
      await ctx.close();
    }
  });

  test('reconnect after disconnect — code exchange restores the connection', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();

    try {
      const hostPage = await hostCtx.newPage();
      const guestPage = await guestCtx.newPage();

      // ── 1. Initial connection (same as main test) ─────────────────────────
      await hostPage.goto('/');
      await hostPage.click('#btn-create');
      await hostPage.fill('#title-input', 'Reconnect Test');
      await hostPage.click('#btn-start-create');

      const inviteCodeLocator = hostPage.locator('#invite-code');
      await expect(inviteCodeLocator).not.toHaveValue('', { timeout: ICE_TIMEOUT });
      const inviteCode = await inviteCodeLocator.inputValue();

      await guestPage.goto('/');
      await guestPage.click('#btn-join');
      await guestPage.fill('#invite-input', inviteCode);
      await guestPage.click('#btn-accept');

      const answerCodeLocator = guestPage.locator('#answer-code');
      await expect(answerCodeLocator).not.toHaveValue('', { timeout: ICE_TIMEOUT });
      const answerCode = await answerCodeLocator.inputValue();

      await hostPage.fill('#answer-input', answerCode);
      await hostPage.click('#btn-finalize');

      // Both reach chat
      await expect(hostPage.locator('.chat-header-status')).toContainText('Connected', {
        timeout: CONNECT_TIMEOUT,
      });
      await expect(guestPage.locator('.chat-header-status')).toContainText('Connected', {
        timeout: CONNECT_TIMEOUT,
      });

      // ── 2. Host disconnects ───────────────────────────────────────────────
      await hostPage.click('#btn-chat-back');
      // Session card for a CONNECTED session shows a Disconnect button
      await hostPage.click('.btn-disconnect');
      // Session list re-renders; session now shows Reconnect button
      await expect(hostPage.locator('.btn-reconnect')).toBeVisible({ timeout: 5000 });

      // Guest: navigate back to session list (DataChannel close propagates)
      await guestPage.click('#btn-chat-back');
      // Wait for guest session to show as disconnected too
      await expect(guestPage.locator('.btn-reconnect')).toBeVisible({ timeout: 10_000 });

      // ── 3. Host: initiate reconnect ───────────────────────────────────────
      await hostPage.click('.btn-reconnect');
      // Host reconnect screen generates a new offer (ICE gathering)
      const reconCodeLocator = hostPage.locator('#recon-code');
      await expect(reconCodeLocator).not.toHaveValue('', { timeout: ICE_TIMEOUT });
      const reconCode = await reconCodeLocator.inputValue();
      expect(reconCode.length).toBeGreaterThan(20);

      // ── 4. Guest: paste reconnect code, get answer ────────────────────────
      await guestPage.click('.btn-reconnect');
      await guestPage.fill('#recon-input', reconCode);
      await guestPage.click('#btn-accept-recon');

      // Guest answer page — copy the answer code
      const reconAnswerLocator = guestPage.locator('#recon-answer-code');
      await expect(reconAnswerLocator).not.toHaveValue('', { timeout: ICE_TIMEOUT });
      const reconAnswer = await reconAnswerLocator.inputValue();
      expect(reconAnswer.length).toBeGreaterThan(20);

      // ── 5. Host: paste guest answer → finalize ────────────────────────────
      await hostPage.fill('#recon-answer', reconAnswer);
      await hostPage.click('#btn-finalize-recon');

      // ── 6. Both sides reconnect ───────────────────────────────────────────
      await expect(hostPage.locator('.chat-header-status')).toContainText('Connected', {
        timeout: CONNECT_TIMEOUT,
      });
      await expect(guestPage.locator('.chat-header-status')).toContainText('Connected', {
        timeout: CONNECT_TIMEOUT,
      });

      // ── 7. Message exchange post-reconnect ────────────────────────────────
      await hostPage.fill('#msg-input', 'Post-reconnect message');
      await hostPage.click('#btn-send');
      await expect(guestPage.locator('#msg-list li').last()).toContainText(
        'Post-reconnect message',
        { timeout: MSG_TIMEOUT },
      );
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
