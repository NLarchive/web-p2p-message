import { createSessionManager } from '../config/composition-root.js';
import { SessionStatus } from '../core/domain/Session.js';
import { ControlAction } from '../core/domain/Envelope.js';

const $ = (sel) => document.querySelector(sel);
const app = document.getElementById('app');
const SOURCE_URL = 'https://github.com/NLarchive/web-p2p-message';

let manager;
let activeSessionId = null;

// ── Toast notification system ──
// Replaces the static <p id="error"> pattern with ephemeral toasts that
// auto-dismiss and stack correctly without requiring an in-DOM anchor.

let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

function showToast(msg, type = 'error', durationMs = 4000) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  // Close on click
  toast.addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);
  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  if (durationMs > 0) setTimeout(() => dismissToast(toast), durationMs);
  return toast;
}

function dismissToast(toastEl) {
  toastEl.classList.remove('toast-visible');
  toastEl.addEventListener('transitionend', () => toastEl.remove(), { once: true });
}

// Keep backwards compat for call sites that used showError
function showError(msg) { showToast(msg, 'error'); }
function showSuccess(msg) { showToast(msg, 'success', 2500); }

// ── Network privacy detection ──
// Detects whether WebRTC is disabled (Tor Browser) by attempting a quick local
// ICE candidate gather without any STUN servers. If RTCPeerConnection is
// unavailable or gathering yields zero candidates, the user is likely behind
// Tor Browser. No external fetch is made — fully local and IP-blind.
let _privacyStatus = null; // null = unchecked | 'tor-browser' | 'webrtc-available' | 'unknown'

async function detectNetworkPrivacy() {
  if (_privacyStatus !== null) return _privacyStatus;
  try {
    if (typeof RTCPeerConnection === 'undefined') {
      _privacyStatus = 'tor-browser';
      return _privacyStatus;
    }
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('probe');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // If WebRTC is blocked (Tor Browser) gathering completes instantly with empty candidates
    const hasCandidates = await new Promise((resolve) => {
      const timer = setTimeout(() => { pc.close(); resolve(false); }, 2000);
      pc.onicecandidate = (e) => {
        if (e.candidate) { clearTimeout(timer); pc.close(); resolve(true); }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(timer); pc.close(); resolve(false); }
      };
    });
    _privacyStatus = hasCandidates ? 'webrtc-available' : 'tor-browser';
  } catch {
    _privacyStatus = 'unknown';
  }
  return _privacyStatus;
}

// ── Helpers ──

function render(html) {
  app.innerHTML = `
    <div class="app-shell">
      ${html}
      <footer class="app-footer">
        <a href="${SOURCE_URL}" target="_blank" rel="noreferrer">Source code (AGPL-3.0)</a>
      </footer>
    </div>
  `;
}

// copyToClipboard: writes text and toggles button label briefly.
function copyToClipboard(text, btn, label = 'Copy') {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = original || label; btn.disabled = false; }, 2000);
    }
    showSuccess('Copied to clipboard');
  }).catch(() => showError('Clipboard write failed'));
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function statusIndicator(status) {
  if (status === SessionStatus.CONNECTED) return '🟢';
  if (status === SessionStatus.CONNECTING ||
      status === SessionStatus.AWAITING_ANSWER ||
      status === SessionStatus.AWAITING_FINALIZE)
    return '🟠';
  return '🔴';
}

function statusLabel(status) {
  if (status === SessionStatus.CONNECTED) return 'Connected';
  if (status === SessionStatus.CONNECTING) return 'Connecting…';
  if (status === SessionStatus.AWAITING_ANSWER) return 'Awaiting answer';
  if (status === SessionStatus.AWAITING_FINALIZE) return 'Awaiting connection';
  if (status === SessionStatus.DISCONNECTED) return 'Disconnected';
  if (status === SessionStatus.EXPIRED) return 'Expired';
  if (status === SessionStatus.ERROR) return 'Error';
  return status;
}

// ── Session List (Home) ──

function showSessionList() {
  activeSessionId = null;
  const sessions = manager.getSessions();
  const sessionCards = sessions
    .map((s) => {
      const indicator = statusIndicator(s.status);
      const label = statusLabel(s.status);
      const title = escapeHtml(s.title || `Chat ${s.id.slice(0, 8)}`);
      const role = s.role === 'host' ? 'Host' : 'Guest';
      const lastMsg = getLastMessagePreview(s.id);
      return `
        <div class="session-card" data-id="${s.id}">
          <div class="session-card-main" data-id="${s.id}">
            <span class="session-indicator">${indicator}</span>
            <div class="session-info">
              <span class="session-title">${title}</span>
              <span class="session-status">${label} · ${role}</span>
              ${lastMsg ? `<span class="session-preview">${escapeHtml(lastMsg)}</span>` : ''}
            </div>
          </div>
          <div class="session-actions">
            ${s.status === SessionStatus.DISCONNECTED ? `<button class="btn-small btn-reconnect" data-id="${s.id}">Reconnect</button>` : ''}
            ${s.status === SessionStatus.CONNECTED ? `<button class="btn-small btn-outline btn-disconnect" data-id="${s.id}">Disconnect</button>` : ''}
            <button class="btn-small btn-outline btn-req-delete" data-id="${s.id}" title="Request mutual delete">🗑️</button>
            <button class="btn-small btn-danger btn-delete" data-id="${s.id}" title="Delete locally">✕</button>
          </div>
        </div>`;
    })
    .join('');

  const hasMultiple = sessions.length > 1;

  render(`
    <h1>P2P Message</h1>
    <h2>Encrypted peer-to-peer chat</h2>
    <div id="privacy-status" class="privacy-status privacy-checking">🔍 Checking network privacy…</div>
    ${hasMultiple ? `<div class="search-bar-wrap"><input type="text" id="session-search" class="session-search" placeholder="Search sessions…" autocomplete="off" /></div>` : ''}
    ${sessions.length > 0 ? `<div class="session-list" id="session-list">${sessionCards}</div>` : '<p class="status mb">No sessions yet. Create or join a chat.</p>'}
    <div class="actions" style="margin-top:1.5rem">
      <button id="btn-create">New Chat (Host)</button>
      <button id="btn-join" class="btn-outline">Join Chat</button>
    </div>
  `);

  // Privacy indicator — non-blocking; updates indicator once result arrives
  const privacyEl = document.getElementById('privacy-status');
  if (privacyEl) {
    detectNetworkPrivacy().then((status) => {
      if (!privacyEl.isConnected) return;
      if (status === 'tor-browser') {
        privacyEl.textContent = '🧅 Tor Browser detected — WebRTC is disabled; real IP hidden';
        privacyEl.className = 'privacy-status privacy-tor';
      } else if (status === 'webrtc-available') {
        privacyEl.textContent = '⚠️ WebRTC active — peer can see your IP. Use Tor or a VPN for IP privacy.';
        privacyEl.className = 'privacy-status privacy-direct';
      } else {
        privacyEl.textContent = '🔒 Network privacy status unknown';
        privacyEl.className = 'privacy-status privacy-unknown';
      }
    });
  }

  // Live DOM-filter search (no full re-render)
  const searchInput = document.getElementById('session-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      document.querySelectorAll('#session-list .session-card').forEach((card) => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? '' : 'none';
      });
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
      }
    });
  }

  // Bind events
  $('#btn-create').addEventListener('click', showCreateForm);
  $('#btn-join').addEventListener('click', showJoinForm);

  for (const el of document.querySelectorAll('.session-card-main')) {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const s = manager.getSession(id);
      if (s && s.status === SessionStatus.CONNECTED) showChat(id);
      else if (s && (s.status === SessionStatus.AWAITING_ANSWER)) showHostWaiting(id);
      else if (s) showSessionDetail(id);
    });
  }
  for (const el of document.querySelectorAll('.btn-reconnect')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleReconnect(el.dataset.id);
    });
  }
  for (const el of document.querySelectorAll('.btn-disconnect')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      manager.disconnect(el.dataset.id);
    });
  }
  for (const el of document.querySelectorAll('.btn-req-delete')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRequestDelete(el.dataset.id);
    });
  }
  for (const el of document.querySelectorAll('.btn-delete')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteLocal(el.dataset.id);
    });
  }
}

function getLastMessagePreview(sessionId) {
  const msgs = manager.getMessages(sessionId);
  if (msgs.length === 0) return '';
  const last = msgs[msgs.length - 1];
  const prefix = last.self ? 'You: ' : '';
  const text = last.text.length > 40 ? last.text.slice(0, 40) + '…' : last.text;
  return prefix + text;
}

// ── Create (Host) Flow ──

function showCreateForm() {
  render(`
    <h1>New Chat</h1>
    <div class="card">
      <label class="field-label">Chat Title (optional)</label>
      <input type="text" id="title-input" placeholder="e.g. Work Chat" autocomplete="off" />
    </div>
    <div class="actions">
      <button id="btn-start-create">Create</button>
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
    <p id="error" class="error"></p>
  `);
  $('#btn-start-create').addEventListener('click', handleCreate);
  $('#btn-back').addEventListener('click', showSessionList);
}

async function handleCreate() {
  const btn = $('#btn-start-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    const title = $('#title-input').value.trim();
    const { sessionId, inviteCode } = await manager.createSession(title);
    showInviteCode(sessionId, inviteCode);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create'; }
    showError(e.message);
  }
}

function showInviteCode(sessionId, inviteCode) {
  render(`
    <h1>Share Invite</h1>
    <p class="status mb">Send this code to the other person:</p>
    <textarea id="invite-code" rows="4" readonly>${inviteCode}</textarea>
    <div class="actions">
      <button id="btn-copy">Copy</button>
    </div>
    <div class="card" style="margin-top:1rem">
      <p class="mb">Paste their answer code:</p>
      <textarea id="answer-input" rows="4" placeholder="Paste answer code here..."></textarea>
      <div class="actions">
        <button id="btn-finalize">Connect</button>
      </div>
      <p id="error" class="error"></p>
    </div>
    <div class="actions">
      <button id="btn-back" class="btn-outline">Back to Sessions</button>
    </div>
  `);
  $('#btn-copy').addEventListener('click', () => {
    copyToClipboard(inviteCode, $('#btn-copy'));
  });
  $('#btn-finalize').addEventListener('click', () => handleFinalize(sessionId));
  $('#btn-back').addEventListener('click', showSessionList);
}

function showHostWaiting(sessionId) {
  const entry = manager.getEntry(sessionId);
  if (!entry) return showSessionList();
  const inviteCode = entry.pendingSignal?.type === 'invite'
    ? entry.pendingSignal.code
    : '';
  render(`
    <h1>${escapeHtml(entry.session.title || 'Chat')}</h1>
    <p class="status mb">🟠 Awaiting answer code from peer</p>
    ${inviteCode ? `
    <div class="card">
      <p class="mb">Stored invite code:</p>
      <textarea id="invite-code" rows="4" readonly>${inviteCode}</textarea>
      <div class="actions">
        <button id="btn-copy">Copy</button>
      </div>
    </div>` : ''}
    <div class="card">
      <p class="mb">Paste the answer code:</p>
      <textarea id="answer-input" rows="4" placeholder="Paste answer code here..."></textarea>
      <div class="actions">
        <button id="btn-finalize">Connect</button>
      </div>
      <p id="error" class="error"></p>
    </div>
    <div class="actions">
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
  `);
  if ($('#btn-copy')) {
    $('#btn-copy').addEventListener('click', () => {
      copyToClipboard(inviteCode, $('#btn-copy'));
    });
  }
  $('#btn-finalize').addEventListener('click', () => handleFinalize(sessionId));
  $('#btn-back').addEventListener('click', showSessionList);
}

async function handleFinalize(sessionId) {
  const btn = $('#btn-finalize');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    const answerCode = $('#answer-input').value.trim();
    if (!answerCode) {
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
      return showError('Paste the answer code first');
    }    if (answerCode.length < 10) {
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
      return showError('Answer code looks too short — did you paste the full code?');
    }    await manager.finalizeSession(sessionId, answerCode);
    activeSessionId = sessionId;
    // Transport listener will fire 'update' when connected → showChat
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
    showError(e.message);
  }
}

// ── Join (Guest) Flow ──

function showJoinForm() {
  render(`
    <h1>Join Chat</h1>
    <p class="status mb" style="margin-top:1rem">Paste the invite code you received:</p>
    <textarea id="invite-input" rows="4" placeholder="Paste invite code here..."></textarea>
    <div class="actions">
      <button id="btn-accept">Accept Invite</button>
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
    <p id="error" class="error"></p>
  `);
  $('#btn-accept').addEventListener('click', handleJoin);
  $('#btn-back').addEventListener('click', showSessionList);
}

async function handleJoin() {
  const btn = $('#btn-accept');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    const inviteCode = $('#invite-input').value.trim();
    if (!inviteCode) {
      if (btn) { btn.disabled = false; btn.textContent = 'Accept Invite'; }
      return showError('Paste the invite code first');
    }
    if (inviteCode.length < 10) {
      if (btn) { btn.disabled = false; btn.textContent = 'Accept Invite'; }
      return showError('Invite code looks too short — did you paste the full code?');
    }
    const { sessionId, answerCode } = await manager.joinSession(inviteCode);
    showAnswerCode(sessionId, answerCode);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Accept Invite'; }
    showError(e.message);
  }
}

function showAnswerCode(sessionId, answerCode) {
  render(`
    <h1>Send Answer</h1>
    <p class="status mb">Role: Guest</p>
    <p class="status mb">Send this answer code back to the host:</p>
    <textarea id="answer-code" rows="4" readonly>${answerCode}</textarea>
    <div class="actions">
      <button id="btn-copy-answer">Copy</button>
    </div>
    <p class="status mb" style="margin-top:1rem">🟠 Waiting for connection…</p>
    <div class="actions">
      <button id="btn-back" class="btn-outline">Back to Sessions</button>
    </div>
    <p id="error" class="error"></p>
  `);
  $('#btn-copy-answer').addEventListener('click', () => {
    copyToClipboard(answerCode, $('#btn-copy-answer'));
  });
  $('#btn-back').addEventListener('click', showSessionList);
  activeSessionId = sessionId;
}

// ── Reconnect Flow ──

/**
 * Automatically routes reconnection based on stored role — no manual choice.
 */
function handleReconnect(sessionId) {
  const s = manager.getSession(sessionId);
  if (!s) return;
  if (s.role === 'host') handleReconnectHost(sessionId);
  else showReconnectGuest(sessionId);
}

async function handleReconnectHost(sessionId) {
  const btn = $('#btn-recon-host');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    const reconnectCode = await manager.reconnectAsHost(sessionId);
    showReconnectInvite(sessionId, reconnectCode);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "I'm the Host (create code)"; }
    showError(e.message);
  }
}

function showReconnectInvite(sessionId, reconnectCode) {
  render(`
    <h1>Reconnect — Host</h1>
    <p class="status mb">Role: Host</p>
    <p class="status mb">Send this reconnect code to your peer:</p>
    <textarea id="recon-code" rows="4" readonly>${reconnectCode}</textarea>
    <div class="actions">
      <button id="btn-copy-recon">Copy</button>
    </div>
    <div class="card" style="margin-top:1rem">
      <p class="mb">Paste their answer code:</p>
      <textarea id="recon-answer" rows="4" placeholder="Paste answer code here..."></textarea>
      <div class="actions">
        <button id="btn-finalize-recon">Connect</button>
      </div>
      <p id="error" class="error"></p>
    </div>
    <div class="actions">
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
  `);
  $('#btn-copy-recon').addEventListener('click', () => {
    copyToClipboard(reconnectCode, $('#btn-copy-recon'));
  });
  $('#btn-finalize-recon').addEventListener('click', async () => {
    const btn = $('#btn-finalize-recon');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    try {
      const answer = $('#recon-answer').value.trim();
      if (!answer) {
        if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
        return showError('Paste the answer code first');
      }
      await manager.finalizeReconnect(sessionId, answer);
      activeSessionId = sessionId;
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
      showError(e.message);
    }
  });
  $('#btn-back').addEventListener('click', showSessionList);
}

function showReconnectGuest(sessionId) {
  render(`
    <h1>Reconnect — Guest</h1>
    <p class="status mb">Role: Guest</p>
    <p class="status mb">Paste the reconnect code from your peer:</p>
    <textarea id="recon-input" rows="4" placeholder="Paste reconnect code here..."></textarea>
    <div class="actions">
      <button id="btn-accept-recon">Accept</button>
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
    <p id="error" class="error"></p>
  `);
  $('#btn-accept-recon').addEventListener('click', async () => {
    const btn = $('#btn-accept-recon');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    try {
      const code = $('#recon-input').value.trim();
      if (!code) {
        if (btn) { btn.disabled = false; btn.textContent = 'Accept'; }
        return showError('Paste the reconnect code first');
      }
      const answerCode = await manager.reconnectAsGuest(sessionId, code);
      showReconnectAnswer(sessionId, answerCode);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Accept'; }
      showError(e.message);
    }
  });
  $('#btn-back').addEventListener('click', showSessionList);
}


function showReconnectAnswer(sessionId, answerCode) {
  // The guest's side of reconnection is now complete — the new WebRTC answer
  // has been created and the transport listeners are set up. The connection
  // will complete automatically (via onSessionUpdate → showChat) once the
  // host calls finalizeReconnect and ICE/DTLS negotiate. No further action
  // needed from the guest except sending the answer code to the host.
  render(`
    <h1>Reconnect — Guest</h1>
    <p class="status mb">Step 2 of 2: Send this answer code back to the host.</p>
    <textarea id="recon-answer-code" rows="4" readonly>${answerCode}</textarea>
    <div class="actions">
      <button id="btn-copy-recon-answer">Copy Answer Code</button>
    </div>
    <div class="card" style="margin-top:1rem">
      <p class="mb">🟠 Waiting for host to complete the connection…</p>
      <p style="font-size:0.8rem;color:var(--text-muted)">Once the host pastes your answer code and clicks Connect, this screen will automatically switch to the chat.</p>
    </div>
    <div class="actions">
      <button id="btn-back" class="btn-outline">Back to Sessions</button>
    </div>
  `);
  $('#btn-copy-recon-answer').addEventListener('click', () => {
    copyToClipboard(answerCode, $('#btn-copy-recon-answer'));
  });
  $('#btn-back').addEventListener('click', showSessionList);
  // Set activeSessionId so onSessionUpdate auto-navigates to chat on connect
  activeSessionId = sessionId;
}

// ── Session Detail ──

function showSessionDetail(sessionId) {
  const s = manager.getSession(sessionId);
  if (!s) return showSessionList();
  const entry = manager.getEntry(sessionId);

  // Status-aware action buttons in the detail view:
  //  - Disconnected: "Retry Connection" (primary) + "Reconnect" (manual flow)
  //  - Connected: "Open Chat"
  //  - Pending: no action button (waiting for peer)
  const isDisconnected = s.status === SessionStatus.DISCONNECTED;
  const isPending = s.status === SessionStatus.AWAITING_ANSWER ||
    s.status === SessionStatus.AWAITING_FINALIZE ||
    s.status === SessionStatus.CONNECTING;

  const fpChanged = s._previousRemoteFingerprint && s.remoteIdentity &&
    s._previousRemoteFingerprint !== s.remoteIdentity.fingerprint;

  render(`
    <h1>${escapeHtml(s.title || 'Chat ' + s.id.slice(0, 8))}</h1>
    ${fpChanged ? `<div class="card fp-warning"><p>⚠️ <strong>Peer keys changed!</strong> The peer's fingerprint is different from the previous session. Stop and verify via another channel before continuing.</p></div>` : ''}
    <div class="card">
      <p class="status">${statusIndicator(s.status)} ${statusLabel(s.status)}</p>
      <p style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-muted)">Role: ${s.role === 'host' ? 'Host' : 'Guest'}</p>
      ${s.localIdentity ? `<p style="font-size:0.8rem;color:var(--text-muted)">Your fingerprint: <span class="fingerprint">${s.localIdentity.fingerprint}</span></p>` : ''}
      ${s.remoteIdentity ? `<p style="font-size:0.8rem;color:var(--text-muted)">Peer fingerprint: <span class="fingerprint">${s.remoteIdentity.fingerprint}</span>
        <span class="fp-badge ${s.fingerprintVerified ? 'fp-verified' : 'fp-unverified'}">${s.fingerprintVerified ? '✔ Verified' : 'Unverified'}</span></p>` : ''}
      ${s.remoteIdentity && !s.fingerprintVerified ? `<button id="btn-verify-fp" class="btn-small btn-outline" style="margin-top:0.3rem">Mark as Verified</button>` : ''}
      ${s.remoteIdentity && s.fingerprintVerified ? `<button id="btn-unverify-fp" class="btn-small btn-outline" style="margin-top:0.3rem">Reset Verification</button>` : ''}
    </div>
    ${entry?.pendingSignal?.code ? `
    <div class="card">
      <label class="field-label">Stored Session Code</label>
      <textarea id="stored-code" rows="4" readonly>${entry.pendingSignal.code}</textarea>
      <div class="actions">
        <button id="btn-copy-stored-code">Copy Code</button>
      </div>
    </div>` : ''}
    <div class="card">
      <label class="field-label">Chat Title</label>
      <div class="send-bar">
        <input type="text" id="edit-title" value="${escapeHtml(s.title || '')}" placeholder="Set title…" autocomplete="off" />
        <button id="btn-save-title">Save</button>
      </div>
    </div>
    <div class="actions">
      ${isDisconnected ? `<button id="btn-retry" class="btn-retry">Reconnect</button>` : ''}
      ${isPending ? `<button id="btn-refresh-status" class="btn-outline">Refresh Status</button>` : ''}
      ${s.status === SessionStatus.CONNECTED ? `<button id="btn-open-chat">Open Chat</button>` : ''}
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
    <p class="status" style="margin-top:1rem;font-size:0.75rem"><a href="https://github.com/NLarchive/web-p2p-message/blob/main/docs/security.md" target="_blank" rel="noreferrer">Security notes</a> — browser compromise is out of scope; this app does not add extra risks.</p>
    <p id="error" class="error"></p>
  `);

  $('#btn-save-title').addEventListener('click', async () => {
    const title = $('#edit-title').value.trim();
    await manager.sendTitle(sessionId, title);
    showSuccess('Title updated');
  });
  if ($('#btn-copy-stored-code')) {
    $('#btn-copy-stored-code').addEventListener('click', () => {
      copyToClipboard(entry.pendingSignal.code, $('#btn-copy-stored-code'));
    });
  }
  if ($('#btn-verify-fp')) {
    $('#btn-verify-fp').addEventListener('click', async () => {
      s.fingerprintVerified = true;
      await manager._persistSession(sessionId);
      showSuccess('Fingerprint marked as verified');
      showSessionDetail(sessionId);
    });
  }
  if ($('#btn-unverify-fp')) {
    $('#btn-unverify-fp').addEventListener('click', async () => {
      s.fingerprintVerified = false;
      await manager._persistSession(sessionId);
      showSessionDetail(sessionId);
    });
  }
  if ($('#btn-retry')) {
    $('#btn-retry').addEventListener('click', () => handleReconnect(sessionId));
  }
  // Refresh status: re-renders the detail view with latest session state
  if ($('#btn-refresh-status')) {
    $('#btn-refresh-status').addEventListener('click', () => showSessionDetail(sessionId));
  }
  if ($('#btn-open-chat')) {
    $('#btn-open-chat').addEventListener('click', () => showChat(sessionId));
  }
  $('#btn-back').addEventListener('click', showSessionList);
}

// ── Delete Handlers ──

async function handleRequestDelete(sessionId) {
  if (!confirm('Request the other peer to delete this session?')) return;
  await manager.requestDelete(sessionId);
  showSessionList();
}

async function handleDeleteLocal(sessionId) {
  if (!confirm('Delete this session locally?')) return;
  await manager.deleteSession(sessionId);
  showSessionList();
}

// ── Chat ──

function showChat(sessionId) {
  activeSessionId = sessionId;
  const s = manager.getSession(sessionId);
  if (!s) return showSessionList();
  const entry = manager.getEntry(sessionId);
  const msgs = manager.getMessages(sessionId);

  render(`
    <div class="chat-header">
      <button id="btn-chat-back" class="btn-small btn-outline">←</button>
      <div class="chat-header-info">
        <span class="chat-header-title">${escapeHtml(s.title || 'Chat ' + s.id.slice(0, 8))}</span>
        <span class="chat-header-status">${statusIndicator(s.status)} ${statusLabel(s.status)} · ${s.role === 'host' ? 'Host' : 'Guest'}</span>
      </div>
      <button id="btn-chat-detail" class="btn-small btn-outline">ⓘ</button>
    </div>
    ${s.localIdentity && s.remoteIdentity ? `
    <div class="card" style="padding:0.6rem 0.8rem;">
      <p style="font-size:0.75rem;color:var(--text-muted)">
        You: <span class="fingerprint" style="font-size:0.75rem">${s.localIdentity.fingerprint}</span> ·
        Peer: <span class="fingerprint" style="font-size:0.75rem">${s.remoteIdentity.fingerprint}</span>
        <span class="fp-badge ${s.fingerprintVerified ? 'fp-verified' : 'fp-unverified'}">${s.fingerprintVerified ? '✔ Verified' : 'Unverified'}</span>
      </p>
    </div>` : ''}
    <ul class="messages" id="msg-list"></ul>
    <div class="send-bar">
      <input type="text" id="msg-input" placeholder="Type a message…" autocomplete="off" ${s.status !== SessionStatus.CONNECTED ? 'disabled' : ''} />
      <button id="btn-send" ${s.status !== SessionStatus.CONNECTED ? 'disabled' : ''}>Send</button>
    </div>
    <p id="error" class="error"></p>
  `);

  // Render existing messages
  const list = document.getElementById('msg-list');
  for (const m of msgs) {
    appendMessageEl(list, m, m.self);
  }
  if (list) list.scrollTop = list.scrollHeight;

  $('#btn-chat-back').addEventListener('click', showSessionList);
  $('#btn-chat-detail').addEventListener('click', () => showSessionDetail(sessionId));
  $('#btn-send').addEventListener('click', () => handleSend(sessionId));
  $('#msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(sessionId);
    }
  });
  $('#msg-input')?.focus();
}

async function handleSend(sessionId) {
  const input = $('#msg-input');
  const text = input?.value.trim();
  if (!text) return;
  try {
    await manager.sendMessage(sessionId, text);
    if (input) { input.value = ''; input.focus(); }
  } catch (e) {
    showError(e.message);
  }
}

function appendMessageEl(list, msg, isSelf) {
  if (!list) return;
  const li = document.createElement('li');
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const who = isSelf ? 'You' : 'Peer';
  li.innerHTML = `<span class="from">${who}</span>${escapeHtml(msg.text)}<span class="time">${time}</span>`;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

// ── Event Handlers ──

function onSessionUpdate(sessionId) {
  const s = manager.getSession(sessionId);
  // If viewing a session that just connected, switch to chat
  if (activeSessionId === sessionId && s?.status === SessionStatus.CONNECTED) {
    const current = document.querySelector('.chat-header');
    if (!current) {
      showChat(sessionId);
      return;
    }
  }
  // If on session list, refresh it
  if (!activeSessionId) {
    showSessionList();
    return;
  }
  // If viewing this session's chat, update header
  if (activeSessionId === sessionId) {
    const headerStatus = document.querySelector('.chat-header-status');
    if (headerStatus && s) {
      headerStatus.textContent = `${statusIndicator(s.status)} ${statusLabel(s.status)} · ${s.role === 'host' ? 'Host' : 'Guest'}`;
    }
    // Enable/disable send
    const input = $('#msg-input');
    const btn = $('#btn-send');
    if (s?.status === SessionStatus.CONNECTED) {
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
    } else {
      if (input) input.disabled = true;
      if (btn) btn.disabled = true;
    }
    // If session deleted, go back
    if (!s) showSessionList();
  }
}

function onMessage(sessionId, message, isSelf) {
  if (activeSessionId === sessionId) {
    const list = document.getElementById('msg-list');
    appendMessageEl(list, { ...message, self: isSelf }, isSelf);
  }
}

function onControl(sessionId, action, data) {
  if (action === ControlAction.DELETE_REQUEST && !data.outgoing) {
    const s = manager.getSession(sessionId);
    const title = s?.title || sessionId.slice(0, 8);
    if (confirm(`Peer requests to delete "${title}". Confirm deletion?`)) {
      manager.confirmDelete(sessionId);
    }
  }
  if (action === ControlAction.TITLE && data?.title) {
    // Peer sent their title — could be shown as subtitle
    // For simplicity, we emit an update to refresh display
    onSessionUpdate(sessionId);
  }
}

// ── Boot ──

async function boot() {
  const { manager: m, router } = createSessionManager();
  manager = m;
  manager.on('update', onSessionUpdate);
  manager.on('message', onMessage);
  manager.on('control', onControl);

  if (router) {
    // Wait for the SharedWorker to confirm it is operational before showing the
    // UI. The init message arrives almost immediately from a working worker.
    // If the worker fails (RTCPeerConnection unavailable, load error, etc.) the
    // 300 ms timeout fires, marks it dead, and we fall back to direct WebRTC.
    await new Promise((resolve) => {
      const timer = setTimeout(() => { router.markDead(); resolve(); }, 300);
      router.onInit((sessions) => {
        clearTimeout(timer);
        // Rehydrate any connections that survived the page refresh.
        if (router.isAlive) {
          for (const { sessionId, state } of sessions) {
            if (state === 'connected' || state === 'connecting') {
              manager.rehydrateConnection(sessionId, state);
            }
          }
        }
        resolve();
      });
    });
  }

  await manager.loadSessions();
  showSessionList();
}

boot();
