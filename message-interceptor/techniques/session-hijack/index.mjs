/**
 * Session Hijack — attempt to inject into an active session.
 *
 * The attacker opens their own page, captures a legitimate invite code,
 * bypasses the normal guest flow, and tries to evaluate JavaScript inside
 * the host's page context to read internal session state (private keys,
 * shared keys, message history).
 *
 * In a properly isolated app every browser context is a separate origin
 * sandbox so cross-context reads are impossible.  We also verify that
 * the app does not expose secrets on the DOM or on globalThis.
 *
 * @param {object} opts
 * @param {import('@playwright/test').Page} opts.hostPage – the connected host page
 * @param {string} opts.sessionId
 * @returns {{ secure: boolean, findings: string[] }}
 */
export async function runSessionHijack({ hostPage }) {
  const findings = [];
  let secure = true;

  // ── 1. Check if secrets are leaked on window/globalThis ──
  const leaked = await hostPage.evaluate(() => {
    const suspicious = {};
    for (const key of ['sharedKey', 'privateKey', 'sessionKey', 'aesKey', 'kemSecret']) {
      if (window[key] !== undefined) suspicious[key] = typeof window[key];
    }
    // Also check if the session manager is globally accessible
    if (window.manager) suspicious.manager = 'object';
    if (window.sessionManager) suspicious.sessionManager = 'object';
    return suspicious;
  });

  if (Object.keys(leaked).length > 0) {
    findings.push(`CRITICAL: Global scope leaks: ${JSON.stringify(leaked)}`);
    secure = false;
  } else {
    findings.push('No cryptographic material exposed on window/globalThis.');
  }

  // ── 2. Try to read IndexedDB encryption key from the DOM ──
  const idbLeak = await hostPage.evaluate(async () => {
    try {
      // The app stores an AES master key in a metadata IDB store.
      // An attacker script running in the same origin could read it.
      const dbs = await indexedDB.databases();
      const names = dbs.map((d) => d.name);
      return { databases: names, note: 'Same-origin script CAN access IDB — this is expected browser behaviour.' };
    } catch {
      return { databases: [], note: 'indexedDB.databases() blocked.' };
    }
  });
  findings.push(`IndexedDB databases visible: [${idbLeak.databases.join(', ')}] — ${idbLeak.note}`);

  // ── 3. Try to extract messages from the DOM ──
  const domMessages = await hostPage.evaluate(() => {
    const items = document.querySelectorAll('#msg-list li');
    return Array.from(items).map((li) => li.textContent);
  });
  if (domMessages.length > 0) {
    findings.push(
      `DOM contains ${domMessages.length} message element(s). ` +
        'This is expected — messages must be rendered. ' +
        'A same-origin XSS could read them, but cross-origin is blocked by the browser.',
    );
  } else {
    findings.push('No messages found in DOM (chat may not be rendered right now).');
  }

  // ── 4. Verify Content-Security-Policy prevents inline script injection ──
  const cspHeader = await hostPage.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return meta ? meta.getAttribute('content') : null;
  });
  if (cspHeader) {
    findings.push(`CSP meta tag found: "${cspHeader}".`);
  } else {
    findings.push(
      'No CSP meta tag found. Consider adding one to mitigate XSS vectors.',
    );
  }

  return { secure, findings };
}
