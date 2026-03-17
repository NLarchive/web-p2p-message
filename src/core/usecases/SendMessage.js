import { Message } from '../domain/Message.js';
import { SessionStatus } from '../domain/Session.js';

export class SendMessage {
  constructor({ transport, crypto }) {
    this._transport = transport;
    this._crypto = crypto;
  }

  async execute(session, text) {
    if (session.status !== SessionStatus.CONNECTED) {
      throw new Error('Session is not connected');
    }

    const counter = session.nextMessageCounter();
    const message = new Message({
      id: crypto.randomUUID(),
      text,
      from: session.localIdentity.fingerprint,
      timestamp: Date.now(),
      counter,
    });

    const encrypted = await this._crypto.encrypt(
      message.toPlaintext(),
      session.sharedKey,
    );
    this._transport.send(encrypted);

    return message;
  }
}
