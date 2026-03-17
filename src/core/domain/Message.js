import { validateMessageText } from '../../shared/validation/constraints.js';
import { ValidationError } from '../../shared/errors/AppErrors.js';

export class Message {
  constructor({ id, text, from, timestamp = Date.now(), counter }) {
    const error = validateMessageText(text);
    if (error) throw new ValidationError(error);
    if (typeof counter !== 'number' || counter < 1) {
      throw new ValidationError('Message counter must be a positive number');
    }

    this.id = id;
    this.text = text;
    this.from = from;
    this.timestamp = timestamp;
    this.counter = counter;
  }

  toPlaintext() {
    return JSON.stringify({
      id: this.id,
      text: this.text,
      from: this.from,
      timestamp: this.timestamp,
      counter: this.counter,
    });
  }

  static fromPlaintext(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    return new Message(data);
  }
}
