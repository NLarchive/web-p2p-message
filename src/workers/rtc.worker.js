/**
 * SharedWorker — holds RTCPeerConnection instances across page refreshes.
 * Each browsing context (tab) connects via a MessagePort. When a tab refreshes
 * it reconnects to this same worker and receives the current connection states,
 * so live connections survive page reloads as long as any tab is open.
 */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const DATA_CHANNEL_LABEL = 'p2p-message';
const ICE_GATHER_TIMEOUT_MS = 5000;

// Map<sessionId, { pc, dc, state: string, ports: Set<MessagePort> }>
const sessions = new Map();

addEventListener('connect', (event) => {
  const port = event.ports[0];
  port.start();

  // If RTCPeerConnection is not available in this worker context, report it
  // so the main page falls back to direct WebRTC without hanging.
  const noWebRtc = typeof RTCPeerConnection === 'undefined';

  // Tell the new page about all currently active sessions
  const currentSessions = [];
  for (const [sessionId, conn] of sessions) {
    conn.ports.add(port);
    currentSessions.push({ sessionId, state: conn.state });
  }
  port.postMessage({ type: 'init', sessions: currentSessions, noWebRtc });

  if (!noWebRtc) {
    port.addEventListener('message', (e) => handleCmd(port, e.data));
  }
});

async function handleCmd(port, msg) {
  const { cmd, sessionId, data } = msg;
  try {
    switch (cmd) {
      case 'create-offer': {
        ensureSession(sessionId).ports.add(port);
        const offer = await createOffer(sessionId);
        port.postMessage({ type: 'offer', sessionId, offer });
        break;
      }
      case 'accept-offer': {
        ensureSession(sessionId).ports.add(port);
        const answer = await acceptOffer(sessionId, data.offerSdp);
        port.postMessage({ type: 'answer', sessionId, answer });
        break;
      }
      case 'accept-answer': {
        const conn = sessions.get(sessionId);
        if (conn?.pc) await conn.pc.setRemoteDescription(data.answerSdp);
        break;
      }
      case 'send': {
        const conn = sessions.get(sessionId);
        if (conn?.dc?.readyState === 'open') conn.dc.send(data.payload);
        break;
      }
      case 'close': {
        const conn = sessions.get(sessionId);
        if (conn) {
          try { conn.dc?.close(); } catch { /* ignore */ }
          try { conn.pc?.close(); } catch { /* ignore */ }
          sessions.delete(sessionId);
          broadcastAll({ type: 'state', sessionId, state: 'disconnected' });
        }
        break;
      }
      case 'subscribe': {
        // Re-attach a port that is re-joining after a page refresh
        const conn = sessions.get(sessionId);
        if (conn) {
          conn.ports.add(port);
          port.postMessage({ type: 'state', sessionId, state: conn.state });
        }
        break;
      }
    }
  } catch (e) {
    port.postMessage({ type: 'error', sessionId, error: e.message });
  }
}

function ensureSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      pc: null,
      dc: null,
      state: 'new',
      ports: new Set(),
    });
  }
  return sessions.get(sessionId);
}

async function createOffer(sessionId) {
  const conn = ensureSession(sessionId);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  conn.pc = pc;
  const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
  conn.dc = dc;
  setupDataChannel(sessionId, dc);
  setupPcHandlers(sessionId, pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);
  return pc.localDescription.toJSON();
}

async function acceptOffer(sessionId, offerSdp) {
  const conn = ensureSession(sessionId);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  conn.pc = pc;
  pc.ondatachannel = (event) => {
    conn.dc = event.channel;
    setupDataChannel(sessionId, conn.dc);
    if (conn.dc.readyState === 'open') setState(sessionId, 'connected');
  };
  setupPcHandlers(sessionId, pc);
  await pc.setRemoteDescription(offerSdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIce(pc);
  return pc.localDescription.toJSON();
}

function setupDataChannel(sessionId, dc) {
  dc.onopen = () => setState(sessionId, 'connected');
  dc.onclose = () => setState(sessionId, 'disconnected');
  dc.onerror = () => setState(sessionId, 'disconnected');
  dc.onmessage = (event) => {
    broadcastAll({ type: 'message', sessionId, payload: event.data });
  };
}

function setupPcHandlers(sessionId, pc) {
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      setState(sessionId, 'disconnected');
    }
  };
  setState(sessionId, 'connecting');
}

function setState(sessionId, state) {
  const conn = sessions.get(sessionId);
  if (!conn || conn.state === state) return;
  conn.state = state;
  broadcastAll({ type: 'state', sessionId, state });
}

function broadcastAll(msg) {
  const conn = sessions.get(msg.sessionId);
  if (!conn) return;
  const dead = [];
  for (const port of conn.ports) {
    try {
      port.postMessage(msg);
    } catch {
      dead.push(port);
    }
  }
  for (const p of dead) conn.ports.delete(p);
}

function waitForIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const handler = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', handler);
    setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
  });
}
