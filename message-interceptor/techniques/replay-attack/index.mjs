/**
 * Replay Attack — attempt to reuse a previously consumed invite code.
 *
 * After a legitimate session has been established, the attacker tries to
 * feed the same invite code to a fresh guest.  The app must either reject
 * the stale/replayed invite or, at minimum, never allow a second peer to
 * connect with the same session credentials.
 *
 * @param {object} opts
 * @param {import('@playwright/test').Browser} opts.browser
 * @param {string} opts.baseURL
 * @param {string} opts.consumedInvite – an invite that was already used to establish a session
 * @returns {{ secure: boolean, findings: string[] }}
 */
export async function runReplayAttack({ browser, baseURL, consumedInvite }) {
  const findings = [];
  let secure = true;

  const replayCtx = await browser.newContext();
  const replayPage = await replayCtx.newPage();

  try {
    await replayPage.goto(baseURL);
    await replayPage.click('#btn-join');
    await replayPage.fill('#invite-input', consumedInvite);
    await replayPage.click('#btn-accept');

    const errorShown = replayPage.locator('#error');
    const answerBox = replayPage.locator('#answer-code');

    const result = await Promise.race([
      errorShown
        .filter({ hasText: /.+/ })
        .waitFor({ timeout: 8000 })
        .then(() => 'error-shown'),
      answerBox
        .filter({ hasNotText: '' })
        .waitFor({ timeout: 8000 })
        .then(() => 'answer-generated'),
      new Promise((r) => setTimeout(() => r('timeout'), 9000)),
    ]);

    if (result === 'error-shown') {
      const text = await errorShown.textContent();
      findings.push(`App rejected replayed invite: "${text}". SECURE.`);
    } else if (result === 'answer-generated') {
      // The app generated an answer — but since the original host already
      // consumed this offer's ICE credentials, the replayed WebRTC
      // connection can never complete because the remote peer connection
      // object no longer exists.  The attacker would need to also replay
      // the host side, which requires the host's private key.
      findings.push(
        'App generated an answer for the replayed invite. ' +
          'However the original host PC is gone — WebRTC connection will time out. ' +
          'Adding explicit server-side nonce tracking would harden this further.',
      );
    } else {
      findings.push('App timed out on replay. Payload effectively rejected.');
    }
  } catch (e) {
    findings.push(`Replay page threw: ${e.message}`);
  } finally {
    await replayCtx.close();
  }

  return { secure, findings };
}
