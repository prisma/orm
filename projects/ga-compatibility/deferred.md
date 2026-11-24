# GA compatibility: deferred

Work we decided not to do now and do not want to lose. When this folder is closed, each item moves to a ticket or a decision record.

## A declared step that moves a database to a new hash

**What.** A way for a user to move a database from the hash an earlier release computed to the hash a later release computes for the same contract, as a step in the migration system. `db sign` does this today, and it is not meant for production.

**Why it may be needed.** Within a major version the rules that compute a hash do not change, so nothing needs this. It is needed when the rules do change: at a new major version, or if a mistake in the rules ever has to be fixed.

**What it would look like.** Git's plan for moving to a new hash function is the model: the move is declared and made for a whole repository at once, one repository never mixes the two, and a table maps each old name to its new one. For us: one declared step for each database, and a record of which old hash became which new hash, so that the migration history stays connected.

**How stored data says which rules a hash was computed with.** For files, the format version can say it, given one rule: a change to the hashing rules always comes with a new format version, and a writer never writes a version older than the first one that uses the current rules. Each format version then belongs to one set of hashing rules, and several versions may share a set. The database's marker holds a hash and no format version. Its `canonical_version` column exists for this and is always empty today.

**Decided.** Not built now (2026-11-24). At `8.0.0`, projects that used a release candidate sign their databases again with `db sign`.
