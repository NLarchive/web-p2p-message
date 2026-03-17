import { Message } from '../domain/Message.js';
import { SessionStatus } from '../domain/Session.js';

export class ReceiveMessage {
  constructor({ crypto }) {
    this._crypto = crypto;
  }

  async execute(session, encryptedData) {
    if (session.status !== SessionStatus.CONNECTED) {
      throw new Error('Session is not connected');
    }

    const plaintext = await this._crypto.decrypt(
      encryptedData,
      session.sharedKey,
    );
    const message = Message.fromPlaintext(plaintext);

    if (!session.validateReceivedCounter(message.counter)) {
      throw new Error('Message counter is not advancing — possible replay');
    }

    return message;
  }
}
