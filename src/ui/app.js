import { createSessionService } from '../config/composition-root.js';
import { SessionStatus } from '../core/domain/Session.js';

const $ = (sel) => document.querySelector(sel);
const app = document.getElementById('app');
const SOURCE_URL = 'https://github.com/NLarchive/web-p2p-message';

let service;
let session;
let keyPair;

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

function showError(msg) {
  const el = document.getElementById('error');
  if (el) el.textContent = msg;
}

// ── Home ──

function showHome() {
  render(`
    <h1>P2P Message</h1>
    <h2>Encrypted peer-to-peer chat</h2>
    <div class="actions">
      <button id="btn-create">Create Chat</button>
      <button id="btn-join" class="btn-outline">Join Chat</button>
    </div>
  `);
  $('#btn-create').addEventListener('click', handleCreate);
  $('#btn-join').addEventListener('click', showJoinForm);
}

// ── Create ──

async function handleCreate() {
  const btn = $('#btn-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    service = createSessionService();
    const result = await service.createChatSession.execute();
    session = result.session;
    keyPair = result.keyPair;
    showInviteCode(result.inviteCode);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Chat'; }
    showError(e.message);
  }
}

function showInviteCode(inviteCode) {
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
  `);
  $('#btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(inviteCode);
    $('#btn-copy').textContent = 'Copied!';
  });
  $('#btn-finalize').addEventListener('click', handleFinalize);
}

async function handleFinalize() {
  const btn = $('#btn-finalize');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    const answerCode = $('#answer-input').value.trim();
    if (!answerCode) {
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
      return showError('Paste the answer code first');
    }
    await service.finalizeHandshake.execute(session, answerCode, keyPair);
    listenForConnection();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
    showError(e.message);
  }
}

// ── Join ──

function showJoinForm() {
  render(`
    <h1>Join Chat</h1>
    <p class="status mb">Paste the invite code you received:</p>
    <textarea id="invite-input" rows="4" placeholder="Paste invite code here..."></textarea>
    <div class="actions">
      <button id="btn-accept">Accept Invite</button>
      <button id="btn-back" class="btn-outline">Back</button>
    </div>
    <p id="error" class="error"></p>
  `);
  $('#btn-accept').addEventListener('click', handleJoin);
  $('#btn-back').addEventListener('click', showHome);
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
    service = createSessionService();
    const result = await service.joinChatSession.execute(inviteCode);
    session = result.session;
    keyPair = result.keyPair;
    showAnswerCode(result.answerCode);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Accept Invite'; }
    showError(e.message);
  }
}

function showAnswerCode(answerCode) {
  render(`
    <h1>Send Answer</h1>
    <p class="status mb">Send this answer code back to the host:</p>
    <textarea id="answer-code" rows="4" readonly>${answerCode}</textarea>
    <div class="actions">
      <button id="btn-copy-answer">Copy</button>
    </div>
    <p class="status mb" style="margin-top:1rem">Waiting for connection...</p>
    <p id="error" class="error"></p>
  `);
  $('#btn-copy-answer').addEventListener('click', () => {
    navigator.clipboard.writeText(answerCode);
    $('#btn-copy-answer').textContent = 'Copied!';
  });
  listenForConnection();
}

// ── Connection listener ──

function listenForConnection() {
  service.transport.onStateChange((state) => {
    if (state === 'connected') {
      if (session.status === SessionStatus.AWAITING_ANSWER ||
          session.status === SessionStatus.AWAITING_FINALIZE) {
        session.transition(SessionStatus.CONNECTING);
      }
      session.transition(SessionStatus.CONNECTED);
      showChat();
    }
    if (state === 'disconnected' && session.isActive) {
      session.transition(SessionStatus.DISCONNECTED);
      showError('Connection lost');
    }
  });
}

// ── Chat ──

const messages = [];

function showChat() {
  const fp = service.verifyFingerprint.execute(session);
  render(`
    <h1>Chat</h1>
    <div class="card">
      <p class="status connected">Connected</p>
      <p style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-muted)">
        Your fingerprint: <span class="fingerprint">${fp.localFingerprint}</span>
      </p>
      <p style="font-size:0.8rem;color:var(--text-muted)">
        Peer fingerprint: <span class="fingerprint">${fp.remoteFingerprint}</span>
      </p>
    </div>
    <ul class="messages" id="msg-list"></ul>
    <div class="send-bar">
      <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off" />
      <button id="btn-send">Send</button>
    </div>
    <p id="error" class="error"></p>
  `);

  service.transport.onMessage(async (data) => {
    try {
      const msg = await service.receiveMessage.execute(session, data);
      messages.push(msg);
      appendMessage(msg, false);
    } catch (e) {
      showError(e.message);
    }
  });

  $('#btn-send').addEventListener('click', handleSend);
  $('#msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
}

async function handleSend() {
  const input = $('#msg-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    const msg = await service.sendMessage.execute(session, text);
    messages.push(msg);
    appendMessage(msg, true);
    input.value = '';
    input.focus();
  } catch (e) {
    showError(e.message);
  }
}

function appendMessage(msg, isSelf) {
  const list = document.getElementById('msg-list');
  if (!list) return;
  const li = document.createElement('li');
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const who = isSelf ? 'You' : 'Peer';
  li.innerHTML = `<span class="from">${who}</span>${escapeHtml(msg.text)}<span class="time">${time}</span>`;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ── Boot ──
showHome();
