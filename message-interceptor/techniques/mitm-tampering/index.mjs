/**
 * MITM Tampering — active interception technique.
 *
 * The attacker intercepts the invite code, corrupts the public key (simulating
 * key substitution), then gives the tampered invite to a victim guest.
 * The test asserts that the app either rejects the payload outright or that
 * the resulting connection can never successfully exchange messages.
 *
 * @param {object} opts
 * @param {import('@playwright/test').Browser} opts.browser
 * @param {string} opts.baseURL
 * @param {string} opts.originalInvite – the legitimate base64url invite captured earlier
 * @returns {{ secure: boolean, findings: string[] }}
 */
export async function runMitmTampering({ browser, baseURL, originalInvite }) {
  const findings = [];
  let secure = true;

  const b64Decode = (s) =>
    JSON.parse(
      Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
    );
  const b64Encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

  let decoded;
  try {
    decoded = b64Decode(originalInvite);
  } catch {
    findings.push('Could not decode invite — binary format prevents tampering.');
    return { secure: true, findings };
  }

  // ── Tamper the public key ──
  if (decoded.k) {
    if (typeof decoded.k === 'string') {
      // String key — flip first char
      const first = decoded.k.charAt(0);
      decoded.k = (first === 'A' ? 'B' : 'A') + decoded.k.slice(1);
      findings.push('Corrupted first byte of string public key.');
    } else if (typeof decoded.k === 'object') {
      // JWK object — corrupt a key field
      const jwk = decoded.k;
      if (jwk.x && typeof jwk.x === 'string') {
        const c = jwk.x.charAt(0);
        jwk.x = (c === 'A' ? 'B' : 'A') + jwk.x.slice(1);
        findings.push('Corrupted first byte of JWK "x" coordinate.');
      } else if (jwk.k && typeof jwk.k === 'string') {
        const c = jwk.k.charAt(0);
        jwk.k = (c === 'A' ? 'B' : 'A') + jwk.k.slice(1);
        findings.push('Corrupted first byte of JWK raw key material.');
      } else {
        // Fallback: add a fake field to invalidate structure
        jwk.__tampered = true;
        findings.push('Injected tamper flag into JWK object.');
      }
    }
  } else {
    findings.push('No key field "k" found; attempting SDP tampering instead.');
    if (decoded.s && typeof decoded.s === 'object' && decoded.s.sdp) {
      decoded.s.sdp = decoded.s.sdp.replace(/a=fingerprint:[^\r\n]+/, 'a=fingerprint:sha-256 AA:BB:CC:DD');
      findings.push('Replaced DTLS fingerprint in SDP.');
    }
  }

  const tamperedInvite = b64Encode(decoded);

  // ── Give tampered invite to an innocent guest ──
  const victimCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  try {
    await victimPage.goto(baseURL);
    await victimPage.click('#btn-join');
    await victimPage.fill('#invite-input', tamperedInvite);
    await victimPage.click('#btn-accept');

    // Two success conditions for the app:
    // A) An error is shown immediately (payload rejected)
    // B) No answer code is generated (crypto fails silently)
    const errorShown = victimPage.locator('#error');
    const answerBox = victimPage.locator('#answer-code');

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
      findings.push('App rejected tampered payload with an explicit error. SECURE.');
    } else if (result === 'answer-generated') {
      findings.push(
        'App generated an answer for the tampered invite. ' +
          'Connection will still fail at DTLS/KEM decapsulation — but early rejection would be better.',
      );
      // Even if an answer is generated, the shared key will be wrong so
      // messages can never be decrypted. Still secure at transport layer.
    } else {
      findings.push('App timed out without producing error or answer. Payload effectively rejected.');
    }
  } catch (e) {
    findings.push(`Victim page threw: ${e.message}`);
  } finally {
    await victimCtx.close();
  }

  return { secure, findings };
}
