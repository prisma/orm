# Slice: stored files carry a format version

One pull request. Part of the project in [../../spec.md](../../spec.md), section 1.

## What a user sees after it merges

- `contract.json` begins `{ "formatVersion": 1, ... }`. The field was `schemaVersion: "1"`.
- `migration.json` and every ref file, including an extension space's `head.json`, carry `formatVersion: 1`.
- Every command, and the runtime loading `contract.json`, refuses a file whose `formatVersion` is higher than it knows, with a message that says a newer release of Prisma wrote it. It changes nothing.
- A file with no `formatVersion`, or with `schemaVersion`, is refused with a message that names the upgrade instructions.
- A ref file with a field the reader does not know is refused.
- No hash changes. The migration hash leaves `formatVersion` out of its input.
- A release-candidate user runs one script, from the upgrade instructions, that adds or renames the field in every file it applies to.

## What it must not do

- Change a storage, profile, execution or migration hash.
- Read `schemaVersion` as a fallback. The old name is used only to give the clear error.
- Add a framework concept. The contract's format version already exists; the shared check is vocabulary for it.
- Edit frozen history: `upgrade-instructions/releases/**`, `skills/prisma-8/upgrading/**`, `test/integration/test/upgrade-instructions/**` outside the new script's own folder.

## Done when

- Every reader of these files checks the version first: the two family serializers, `readContractEnvelope`, the snapshot store's two readers, the extension self-consistency check, `contractSpaceFromJson`, every `migration.json` and ref reader, and any found beyond them. A test per path shows it refuses a higher version, and `buildReadAggregate` no longer hides that error.
- Each unit has a round-trip test (print, parse, same data).
- The upgrade script has tests with `before` and `after` fixtures, including a run on its own output that changes nothing, and a file it cannot rewrite reported and left alone.
- Every committed `contract.json`, snapshot, `migration.json` and ref file in the repository, outside frozen history, carries `formatVersion: 1`. `pnpm fixtures:check` passes in CI.
- `pnpm check:upgrade-coverage` passes, with an `app` and an `extension` fragment.
- ADR 331, "Stored files carry a format version, and a reader refuses one it does not know", is in the pull request, and every doc that names `schemaVersion` as the contract's field names `formatVersion`.
- `/drive-code-review` on the final commit has no open finding. Manual QA has run `contract emit`, `migration plan`, `db migrate`, `migration status` and an application query against a project on the new format, and the same commands against a file with `formatVersion: 2`, a file with `schemaVersion`, and a ref file with an extra field.
