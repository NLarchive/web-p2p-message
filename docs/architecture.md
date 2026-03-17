# Architecture

## Decision

The selected project structure is Hexagonal Architecture, also known as Ports and Adapters.

This is the best fit for the project because it keeps the application core independent from browser APIs, third-party services, and future implementation changes.

## Core Rule

The core layer never imports from adapters or UI.

Dependency direction:

```text
ui -> config -> core
              -> adapters implement core ports
```

## Target Structure

```text
src/
  core/
    domain/
      Session.js
      Message.js
      PeerIdentity.js
    ports/
      ICryptoPort.js
      IIdentityPort.js
      ISignalingPort.js
      IStoragePort.js
      ITransportPort.js
    usecases/
      CreateChatSession.js
      JoinChatSession.js
      FinalizeHandshake.js
      SendMessage.js
      ReceiveMessage.js
      VerifyFingerprint.js
  adapters/
    crypto/
      WebCryptoEcdhAesGcm.js
      HybridPqCryptoAdapter.js
    identity/
      EphemeralIdentityAdapter.js
      PersistentIdentityAdapter.js
    signaling/
      ManualCodeSignalingAdapter.js
      TorrentSignalingAdapter.js
      NostrSignalingAdapter.js
    storage/
      MemoryStorageAdapter.js
      SessionStorageAdapter.js
      IndexedDbStorageAdapter.js
    transport/
      WebRtcTransportAdapter.js
      BroadcastChannelAdapter.js
  config/
    composition-root.js
  ui/
    app.js
    screens/
    components/
  shared/
    encoding/
    errors/
    validation/
```

## Module Responsibilities

### core/domain

Contains application state and rules:

- session state
- message shape and validation
- peer identity state

No browser APIs should be used here.

### core/ports

Defines the contracts the rest of the system depends on.

Examples:

- crypto operations
- signaling exchange
- transport send and receive
- identity lifecycle
- persistence

These files should be explicit and small so both humans and AI agents can understand them quickly.

### core/usecases

Contains application flows:

- create a chat
- join a chat
- derive session keys
- send encrypted messages
- verify fingerprints

Each use case should depend only on ports and domain objects.

### adapters

Contains the concrete implementations for browsers and optional integrations.

This is where WebRTC, WebCrypto, IndexedDB, BroadcastChannel, or future third-party signaling backends belong.

### config

Provides the composition root. This is the single place where active adapters are selected and wired into the core.

### ui

Handles rendering and user actions. The UI should call use cases through the configured service, not directly call browser transport or crypto details.

## Selected MVP Runtime Design

For the first version:

- signaling uses manual invite code or link exchange
- peer transport uses WebRTC data channels
- encryption uses WebCrypto with ephemeral keys
- storage is minimal and session-oriented

This keeps the first implementation small, auditable, and dependency-light.

## AI Readability Notes

This structure is intentionally AI-friendly because:

- file names reveal purpose clearly
- import flow is one-directional
- contracts are explicit in port files
- implementation swapping happens in one composition file

To preserve this advantage:

- keep naming consistent
- avoid cross-imports between adapters
- avoid hidden singletons and global state
- document each port with short JSDoc