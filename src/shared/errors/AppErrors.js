export class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export class SessionExpiredError extends AppError {
  constructor(message = 'Session has expired') {
    super(message, 'SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

export class InvalidInviteError extends AppError {
  constructor(message = 'Invalid invite code') {
    super(message, 'INVALID_INVITE');
    this.name = 'InvalidInviteError';
  }
}

export class CryptoError extends AppError {
  constructor(message = 'Cryptographic operation failed') {
    super(message, 'CRYPTO_ERROR');
    this.name = 'CryptoError';
  }
}

export class TransportError extends AppError {
  constructor(message = 'Transport operation failed') {
    super(message, 'TRANSPORT_ERROR');
    this.name = 'TransportError';
  }
}

export class ConnectionClosedError extends AppError {
  constructor(message = 'Connection is closed') {
    super(message, 'CONNECTION_CLOSED');
    this.name = 'ConnectionClosedError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class RatchetError extends AppError {
  constructor(message = 'Ratchet operation failed') {
    super(message, 'RATCHET_ERROR');
    this.name = 'RatchetError';
  }
}
