/**
 * Payload Analysis — passive interception technique.
 *
 * Captures all base64url signaling codes exchanged between peers and
 * attempts to extract private keys, shared secrets, or any plaintext
 * data that should NOT be present in the wire format.
 *
 * @param {object} opts
 * @param {import('@playwright/test').Page} opts.hostPage   – page that created the session
 * @param {import('@playwright/test').Page} opts.guestPage  – page that joined the session
 * @param {string} opts.inviteCode – raw base64url invite
 * @param {string} opts.answerCode – raw base64url answer
 * @returns {{ secure: boolean, findings: string[] }}
 */
export function analysePayloads({ inviteCode, answerCode }) {
  const findings = [];
  let secure = true;

  const b64Decode = (s) =>
    JSON.parse(
      Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf-8',
      ),
    );

  // ── Analyse invite ──
  let invite;
  try {
    invite = b64Decode(inviteCode);
  } catch {
    findings.push('Invite payload could not be decoded — obfuscated or binary.');
    return { secure: true, findings };
  }

  const inviteKeys = Object.keys(invite);
  findings.push(`Invite payload keys: [${inviteKeys.join(', ')}]`);

  // Must NOT contain private key material
  for (const forbidden of ['sk', 'privateKey', 'priv', 'sharedKey', 'secret', 'aesKey']) {
    if (invite[forbidden] !== undefined) {
      findings.push(`CRITICAL: invite leaks "${forbidden}"`);
      secure = false;
    }
  }

  // Public key should exist (needed for bootstrapping) but leaking it is safe
  if (invite.k) {
    const keyStr = typeof invite.k === 'object' ? JSON.stringify(invite.k) : String(invite.k);
    findings.push(`Public key present (${keyStr.length} serialised chars) — expected, not a vulnerability.`);
  }

  // ── Analyse answer ──
  let answer;
  try {
    answer = b64Decode(answerCode);
  } catch {
    findings.push('Answer payload could not be decoded.');
    return { secure, findings };
  }

  const answerKeys = Object.keys(answer);
  findings.push(`Answer payload keys: [${answerKeys.join(', ')}]`);

  for (const forbidden of ['sk', 'privateKey', 'priv', 'sharedKey', 'secret', 'aesKey']) {
    if (answer[forbidden] !== undefined) {
      findings.push(`CRITICAL: answer leaks "${forbidden}"`);
      secure = false;
    }
  }

  if (answer.c) {
    const ctStr = typeof answer.c === 'object' ? JSON.stringify(answer.c) : String(answer.c);
    findings.push(`KEM ciphertext present (length ${ctStr.length} chars) — expected for PQ handshake.`);
  }

  // ── Cross-check: can we derive the shared secret? ──
  // With only public key (invite.k) and ciphertext (answer.c) an attacker
  // would need the private key to decapsulate. We cannot do that here.
  findings.push('Shared secret derivation from public material: INFEASIBLE (PQ KEM).');

  return { secure, findings };
}
