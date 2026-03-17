export const MESSAGE_MAX_LENGTH = 10000;
export const SESSION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes for invite expiry
export const SESSION_ID_LENGTH = 16;
export const FINGERPRINT_BYTES = 8;

export function validateMessageText(text) {
  if (typeof text !== 'string') return 'Message text must be a string';
  if (text.length === 0) return 'Message text must not be empty';
  if (text.length > MESSAGE_MAX_LENGTH)
    return `Message text must not exceed ${MESSAGE_MAX_LENGTH} characters`;
  return null;
}

export function isExpired(createdAt, expiryMs = SESSION_EXPIRY_MS) {
  return Date.now() - createdAt > expiryMs;
}
