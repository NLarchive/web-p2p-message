/**
 * Base64url encoding/decoding for binary and text data.
 * Works in both browser and Node.js environments.
 */

export function encode(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeText(text) {
  return encode(new TextEncoder().encode(text));
}

export function decodeText(encoded) {
  return new TextDecoder().decode(decode(encoded));
}

export function encodeJson(obj) {
  return encodeText(JSON.stringify(obj));
}

export function decodeJson(encoded) {
  return JSON.parse(decodeText(encoded));
}
