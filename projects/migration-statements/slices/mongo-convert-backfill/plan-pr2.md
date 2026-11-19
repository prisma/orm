# Slice plan — 4b, PR 2: value objects, embedded models, enum values and variants on MongoDB

**Spec:** [`spec.md`](./spec.md), PR 2 row · **Linear:** [TML-3538](https://linear.app/prisma-company/issue/TML-3538) · **Branch:** `tml-3538-mongo-nested-statements`, from `origin/main` after PR 1 (#30970) merged · **Worktree:** `.claude/worktrees/migration-statements-handover-5072cc`

PR 2 rewrites values below a document's top level: keys inside value objects and embedded models, enum values wherever an enum types a field, and variants' discriminator values. It removes MongoDB's refusals of `valueObjectField`, `enumValue` and discriminator value changes, and the embedded-model refusals PR 1 added. Every operation is self-contained: a precheck, an execute and a postcheck about itself only.

## Dispatches

| # | Outcome | Builds on | Hands to |
| --- | --- | --- | --- |
| 1 | One path walk turns a root field and a JSONPath (`$.a`, `$[*].b`, nested) into an update pipeline and the filters for its precheck and postcheck, guarding every step on `$type`, using `$expr` with `$map` and `$anyElementTrue` for list steps, and wrapping constants in `$literal`. `renameStoredKey`, `removeStoredKey` and `fillStoredKey` exist as `migration.ts` factories, serialize to `ops.json`, render back, and run against mongodb-memory-server. Nothing plans them yet | PR 1 | Runnable stored-key operations |
| 2 | `--rename` and `--delete` of a field inside a value object or an embedded model plan those operations wherever the type is stored: through nesting, lists, embed relations (a list step for one-to-many) and variant branches. Removing such a field is a `valueObjectField` loss, asked like SQL. Refused, naming the field: recursive groups, keys with `.` or `$`, time-series collections, shared collections with no discriminator. The refusals of `valueObjectField` statements and of embedded-model fields are gone. Journey `value-object-statements.mongo` O1 to O5 | 1 | Renames and deletes below the top level |
| 3 | A new required field inside a value object or an embedded model gets a temporary value through `fillStoredKey`, reported in `temporaryValues`; `--backfill Address.zip` writes one `fillStoredKey` per place whose value is `placeholder('Address.zip:value')`, as SQL does. Journey `value-object-backfill.mongo` | 2 | Fills and backfills below the top level |
| 4 | Enum values: `replaceStoredValue` and `removeStoredValue`. `--rename Status.A:Status.B` updates scalar, list, and nested enum fields; values that trade places go through a temporary value; `--delete Status.A` unsets optional fields, pulls from lists, and stops on a required field with a count and advice; `double` values written with `$toDouble`; object and array enums refused. Journey `enum-value-statements.mongo` E1 to E4 | 1 (2 for nested paths) | Enum values |
| 5 | Variants: `deleteDocuments`. `--convert Bug` and a `--rename Bug:Defect` that changes the discriminator value update the documents' value; `--delete Bug` deletes the documents with its value. The selected variant is a typed value, not read back from a filter (`deferred.md`, `otherModelsReached`). Journey `variant-statements.mongo` V1 to V4 | 1 | Variants |
| 6 | Docs and close of the PR: error reference, Migration System § Statements and its MongoDB part, CLI README, `skills/prisma-8/references/migrations.md`, ADR 188, upgrade fragment for the new questions, `deferred.md` path fix, and the spec's "Done when" grep finds nothing | 2 to 5 | PR 2's done conditions |

If the diff after dispatch 4 is already more than one review, dispatch 5 moves to a third PR, as the spec allows.

Each dispatch has one Opus implementer, then one Opus reviewer. After dispatch 6: `/drive-code-review` (both passes, no walkthrough) on the commit to be pushed, fixes, full manual QA on that commit, then the PR.

## Checks for every dispatch

- `pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in every touched package.
- `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm check:upgrade-coverage` and `pnpm check:error-reference` pass.
- The MongoDB journeys that reach the changed commands pass, run by name: every `*.mongo.e2e.test.ts` under `test/integration/test/cli-journeys/`, `mongo-db-update-consent`, plus the runner tests under `test/integration/test/mongo/target-runner/` and any file under `test/integration` that mentions mongo and the changed code.
