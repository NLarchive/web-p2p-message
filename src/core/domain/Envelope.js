export const ControlAction = Object.freeze({
  TITLE: 'title',
  DELETE_REQUEST: 'delete_req',
  DELETE_CONFIRM: 'delete_ack',
});

export function wrapChatMessage(messageData) {
  return JSON.stringify({ t: 'm', d: messageData });
}

export function wrapControl(action, data = {}) {
  return JSON.stringify({ t: 'c', a: action, d: data });
}

export function unwrap(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (parsed.t === 'm') return { type: 'message', data: parsed.d };
  if (parsed.t === 'c')
    return { type: 'control', action: parsed.a, data: parsed.d };
  throw new Error('Unknown envelope type');
}
