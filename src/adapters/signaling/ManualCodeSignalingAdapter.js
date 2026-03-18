import { ISignalingPort } from '../../core/ports/ISignalingPort.js';
import { encodeJson, decodeJson } from '../../shared/encoding/base64url.js';
import {
  InvalidInviteError,
  SessionExpiredError,
} from '../../shared/errors/AppErrors.js';
import { isExpired, validateTimestamp } from '../../shared/validation/constraints.js';

export class ManualCodeSignalingAdapter extends ISignalingPort {
  encodeOffer({ sdp, publicKeyJwk, sessionId, createdAt, cipherText }) {
    const payload = { s: sdp, k: publicKeyJwk, i: sessionId, t: createdAt };
    if (cipherText) payload.c = cipherText;
    return encodeJson(payload);
  }

  decodeOffer(encoded) {
    let data;
    try {
      data = decodeJson(encoded);
    } catch {
      throw new InvalidInviteError('Could not decode invite');
    }
    if (!data.s || !data.k || !data.i || !data.t) {
      throw new InvalidInviteError('Invite is missing required fields');
    }
    const tsError = validateTimestamp(data.t);
    if (tsError) {
      throw new InvalidInviteError(`Invalid invite timestamp: ${tsError}`);
    }
    if (isExpired(data.t)) {
      throw new SessionExpiredError('Invite has expired');
    }
    return {
      sdp: data.s,
      publicKeyJwk: data.k,
      sessionId: data.i,
      createdAt: data.t,
      cipherText: data.c ?? null,
    };
  }

  encodeAnswer({ sdp, publicKeyJwk, sessionId, cipherText }) {
    const payload = { s: sdp, k: publicKeyJwk, i: sessionId };
    if (cipherText) payload.c = cipherText;
    return encodeJson(payload);
  }

  decodeAnswer(encoded) {
    let data;
    try {
      data = decodeJson(encoded);
    } catch {
      throw new InvalidInviteError('Could not decode answer');
    }
    if (!data.s || !data.k || !data.i) {
      throw new InvalidInviteError('Answer is missing required fields');
    }
    return {
      sdp: data.s,
      publicKeyJwk: data.k,
      sessionId: data.i,
      cipherText: data.c ?? null,
    };
  }
}
