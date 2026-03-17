export class VerifyFingerprint {
  execute(session) {
    if (!session.localIdentity || !session.remoteIdentity) {
      return {
        canVerify: false,
        localFingerprint: null,
        remoteFingerprint: null,
      };
    }

    return {
      canVerify: true,
      localFingerprint: session.localIdentity.fingerprint,
      remoteFingerprint: session.remoteIdentity.fingerprint,
    };
  }
}
