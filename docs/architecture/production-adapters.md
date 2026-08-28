# Production adapter and gateway ownership

## Purpose

This document fixes the adapter boundary for the 2026-08-28 canonical desktop application. It gives
the product real production composition points without inventing synthetic success paths, reading old
profiles, or selecting a fallback provider.

## Composition ownership

Only the canonical Electron main entry constructs concrete adapters. The runtime receives narrow
interfaces; it does not discover native services, read the environment for an alternate application,
or silently replace an adapter.

| Owner                        | Must do                                                                                                                                                        | Must not do                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Electron composition root    | Construct the fresh storage profile, CAS/media service, recovery-key boundary, provider gateway registry, protocol handler, IPC host, and shutdown controller. | Probe old data locations, use an old recovery key, or start a second application composition.       |
| Storage authority            | Persist canonical provider-profile metadata, operation state, Skill registry entries, confirmation records, and CAS metadata.                                  | Persist a credential secret, migration provenance, imported-history record, or compatibility alias. |
| Provider profile registry    | Hold redacted profile facts and readiness state. A Run binds one exact profile ID and model.                                                                   | Pick a different profile based on availability, global defaults, or provider order.                 |
| Provider gateway             | Resolve the Run's exact ready profile to its concrete provider adapter and perform the requested operation.                                                    | Retry through a different provider, fabricate a response, or invoke a paid provider during tests.   |
| Credential/recovery boundary | Read or write only the new canonical account when an explicitly configured canonical profile needs it.                                                         | Read, enumerate, copy, rename, or delete existing Keychain accounts/credentials.                    |
| Media gateway/protocol       | Verify canonical CAS identity and serve only authorized opaque capabilities through the Electron protocol.                                                     | Expose filesystem paths/hashes to the renderer or read media from a former application root.        |
| IPC host                     | Bind generated handlers once to the trusted WebContents/frame/URL and publish validated events.                                                                | Register old channels, aliases, broad host objects, or an alternate event bus.                      |
| Renderer                     | Request work through the typed bridge and show explicit unavailable/not-ready/error states.                                                                    | Access a provider, keychain, database, filesystem, or raw Electron IPC API directly.                |

## Provider execution rule

The provider registry may contain multiple canonical profiles, but that does not create a fallback
chain. Every provider-facing request is resolved by the exact persisted profile identifier recorded in
the accepted Run/operation context:

1. Validate the profile ID, enabled/ready state, model, and operation capability.
2. Resolve that profile to the matching concrete adapter.
3. Execute with the immutable request/confirmation binding.
4. Persist the canonical result, failure, usage, receipt, or cancellation state.

If any step fails, the operation remains explicitly unavailable/failed at that exact profile. The UI
may offer a user-directed new request with a different profile, but the gateway never changes profile
on its own. Tests use controlled fake adapters. No validation step may send paid traffic or require
credentials.

## Durable confirmation boundary

Protected actions—including registration of a new user-requested Skill—are not authorized by a UI
boolean or a transient Run interaction. The runtime creates a durable confirmation record that binds
the exact action and immutable input hash. A user reply names that durable confirmation ID and the same
hash. Storage records the resolution atomically with the resulting mutation. The next root Run reads
the new durable state; the active root Run retains its frozen catalog.

This boundary is intentionally shared by the runtime and IPC layers so that rendering, persistence,
and operation execution cannot disagree about what the user approved.

## Native-shell security boundary

The canonical main process owns the trusted renderer identity check, context isolation, session
partition, permission denial, CSP, and opaque media protocol. Browser-only tests can validate UI
behavior but cannot substitute for native-shell validation. The production package must contain the
same canonical entrypoints that those checks exercise.

## Required adapter tests

The main-agent validation ledger must demonstrate:

- exact profile selection with no fallback to another configured provider;
- disabled, missing, or unimplemented profiles fail explicitly;
- no paid request is emitted from test or smoke fixtures;
- the fresh recovery-key boundary does not probe an existing Keychain account;
- canonical media capability checks reject bad identity, expired capability, and invalid range;
- IPC accepts only the trusted renderer sender and rejects unexpected channels/payloads; and
- orderly shutdown prevents new work before closing canonical storage and native resources.

The test commands and result placeholders are in
[../validation/production-cutover.md](../validation/production-cutover.md).
