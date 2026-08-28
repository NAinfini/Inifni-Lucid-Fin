# Canonical Skills

## Status and scope

This document defines the canonical Skill catalog for the 2026-08-28 development reset. It is a
source-controlled product catalog, not a data migration. It preserves the reusable expertise that was
previously expressed by in-repository presets, templates, renderer Skills, process prompts, and prompt
templates. It does not read a person's installed application, custom local records, browser state, or
previous profile.

The checked-in pack SHA-256 is
`73819345c5448277c8eee8dc7f92da2dcaca4c4eaac85cfdc9968d15cff77b88`. Final command results are
recorded in [../validation/production-cutover.md](../validation/production-cutover.md).

The final checked-in pack location is packages/contracts/generated/built-in-skills.v1.json. It is
generated/validated from repository-owned inputs only; it is never populated by opening a previous
application profile. The frozen skill.propose tool definition belongs to the canonical runtime package.

## Built-in catalog invariant

The canonical first-launch pack contains exactly 287 built-in Skills:

| Origin class preserved as a Skill kind |   Count |
| -------------------------------------- | ------: |
| Presets                                |     216 |
| Shot templates                         |      19 |
| Renderer Skills                        |      26 |
| Process prompts                        |      21 |
| Prompt templates                       |       5 |
| **Total**                              | **287** |

Each record is a direct, model-consumable Skill document. Its stable ID has the form
builtin.<kind>.<slug>, its version is plain semantic versioning, and its content is direct Markdown or
text. It must not carry a retired wrapper schema, a retired source-store name, an import/migration
provenance envelope, or a compatibility lookup key.

All 287 records are trusted. The last 37 records were individually reviewed during the cutover: 21
process prompts, 5 prompt templates, and 11 renderer/task-guide Skills. Their rewritten content is
bounded to the typed catalog, returned facts, explicit host confirmation, and no implicit filesystem,
network, credential, paid-service, or source-code authority. Provisioning and catalog validation may
not change trust state. Tests verify all counts, IDs, versions, direct content, and trust state.

## First launch and catalog freezing

On a fresh canonical profile, storage provisions the built-in pack deterministically. It records the
catalog's canonical identity/version/content so that a root Run can freeze the exact set it is allowed
to use. There is no preset manager, template manager, renderer-local cache, process-prompt store, or
browser-local shadow authority.

A running root Run never gains a newly registered Skill halfway through execution. The next root Run
loads the updated durable catalog and freezes its own exact view. This protects reproducibility and
makes a user-visible approval meaningful.

## User-requested Skill creation

A user can ask the AI to add a Skill. The canonical flow is:

1. The AI drafts a structured proposal through skill.propose. It must include the Skill identity,
   version, description, direct instruction content, and any bounded metadata required by the catalog.
2. The runtime validates the proposal and creates a durable, exact-protected confirmation record bound
   to the proposal's immutable input hash.
3. The user explicitly confirms or rejects that durable confirmation. A UI-only acknowledgement or a
   transient Run interaction is insufficient.
4. On confirmation, the Skill is registered atomically in canonical storage with its review/trust
   state. Rejection registers nothing.
5. The next root Run reads the durable registry and may include the new Skill in its frozen catalog.
   The active Run remains unchanged.

The flow has no auto-enable behavior, no hidden prompt injection, no manual modification of a frozen
Run catalog, and no fallback to a previous custom-Skill store. A newly proposed Skill that lacks a
valid document or required confirmation fails explicitly.

## User experience and review policy

The renderer should show whether a proposed Skill is awaiting confirmation, confirmed/registered,
rejected, or unavailable. It must never imply that an unconfirmed proposal is active. The UI can
present trusted and unreviewed states, but it cannot change those states without the corresponding
durable operation.

Built-in content comes from the checked-in catalog. Users who previously had personal local custom
content must request a new Skill in the canonical product; no old local profile is inspected or
transferred. That rule is deliberate because this is a fresh development reset.

## Required tests

The final validation set must prove:

- provisioned count equals 287 with the five exact class counts;
- every built-in ID and semantic version is canonical;
- every content body is direct and contains no retired wrapper/provenance representation;
- all 287 built-ins are trusted and catalog validation cannot rewrite trust state;
- skill.propose requires a durable exact confirmation bound to immutable content;
- confirmation atomically registers a Skill, rejection does not;
- an active root Run remains frozen; the next root Run sees the confirmed registration; and
- no runtime path reads an older preset/template/prompt store or browser-local Skill state.

See [../validation/production-cutover.md](../validation/production-cutover.md) for the result ledger.
