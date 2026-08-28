# Historical Skill source material

These directories preserve reference guides that contributed to the canonical built-in Skill pack
during the 2026-08-28 development cutover. They are historical source material, not executable
configuration and not a second Skill catalog.

The only current built-in catalog is
`packages/contracts/generated/built-in-skills.v1.json`. Its records have canonical IDs, versions,
content hashes, and trust state. Runtime code, documentation, and future agents must not load Skills
from this archive or infer provider availability from its older examples.

User-requested additions use the typed `skill.propose` flow, durable exact confirmation, and canonical
storage registration. Editing an archived Markdown file does not add or change a Skill.
