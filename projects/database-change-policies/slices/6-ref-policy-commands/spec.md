# Slice 6: `migration ref policy` commands read and write a ref's policies — spec

Linear: [TML-3959](https://linear.app/prisma-company/issue/TML-3959). Project spec: [`../../spec.md`](../../spec.md). Plan: [`plan.md`](plan.md). Branch: `tml-3959-ref-policy-commands`.

The operator chose the command names on 2026-11-25. The design passed review by an architect, a principal engineer and a product manager. It is our best effort: where the code shows a part of it is wrong, say so with the evidence and fix the design here.

## At a glance

```text
$ prisma migration ref policy set production --change migrate --data-loss forbidden
✔ Updated the policies ref production declares (migrations/app/refs/production.json)

change:                   migrate, reconcile (default)  →  migrate  tightens
dataProtection.dataLoss:  data-loss-with-consent (default)  →  data-loss-forbidden  tightens

ℹ No database was changed. A database takes on these policies only when its owner applies them in a deploy to production; until then, deploys to production refuse while the database's policies differ. prisma migration plan --to production now checks plans against dataProtection.dataLoss.

$ prisma migration ref policy show production
ℹ Policies ref production declares (migrations/app/refs/production.json)

change:                         migrate
dataProtection.dataLoss:        data-loss-forbidden
dataProtection.accessWidening:  not declared

ℹ These are what the ref declares, not what a database has. Compare with a database: prisma migration status --to production --db <url>

$ prisma migration ref policy delete staging dataProtection.dataLoss
```

The commands rewrite only `migrations/app/refs/<name>.json`, change only the settings named, and never connect to a database. Only the app's refs declare policies, so the commands act only on those.

## Decision

A command group, `prisma migration ref policy`, holds three commands that read and write the `policies` field of a ref file: `show`, `set` and `delete`. `migration ref set` is unchanged: it points a ref at a contract, and declaring policies is not part of that job.

Why the command is acceptable under ADR 320. It writes the working copy of the ref file, which a deploy then reads. It can do nothing that editing the file by hand cannot. A database still takes on a ref's policies only in a deploy its owner gives consent to, and ADR 320 already names "edit the ref, then give consent" as a deliberate workaround that the policies do not try to stop. The policies protect against mistakes, and the command makes a mistaken edit less likely: it rejects invalid values at once and marks every change that loosens a policy.

Why no advice points to it. An agent that has just been refused should fix what it is doing, not loosen the rule that refused it. So no error, next action, command output or skill text tells the reader to loosen a ref's policies, by naming the command or by describing what it does, and no output of these commands names the consent flag. The help for `set` and `delete` says so in plain words.

## Background

A database records two policies in its marker: a change policy (`migrate`, `reconcile`, or both) and a data protection policy (`dataLoss` and `accessWidening`, each `forbidden`, `with-consent` or `permitted`). A ref file declares the policies its database should have, in an optional `policies` object where every key is optional, and an absent key declares nothing. A deploy given a ref refuses when the ref and the database disagree on a declared setting, and changes the database's policies only when given `--permit-policy-change`. `migration plan --to <ref>` refuses a plan that a setting the ref declares as forbidden would forbid. The decision record is "ADR 320 - Databases record a change policy and a data protection policy".

Today a user declares a ref's policies only by editing the file. The values are long fixed strings in a nested object. A mistake is reported, with the allowed values, only when the next command reads the ref (`MIGRATION.INVALID_REF_FILE`).

## Requirements

1. Write any one of the three settings without changing the hash, the invariants or the other settings.
2. Reject an invalid value before touching the file, naming the allowed values.
3. Remove a setting, so the ref declares nothing about it. An absent key declares nothing, which differs from declaring the default.
4. Change no database.
5. No error, next action, command output or skill advice tells the reader to loosen a ref's policies or points to these commands as a way past a refusal. Reference documentation (the skill's section on the ref file, the CLI README and help, the design docs) may name the commands. A source check fails if any file under `packages/**/src` outside the command files and the group text names the command. No output of the three commands contains `--permit-policy-change`.
6. Editing the file by hand keeps working, and the file format does not change.
7. Every change that loosens a policy is labelled `loosens` in the output.

## The commands

All three take the ref name as their first positional argument and accept `--config` like the other `migration ref` commands. Output names settings as the errors do: `change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`, and prints values in the long form the file stores.

### `migration ref policy show <ref>`

Prints the three settings the ref declares, each with its value or "not declared", then says these are what the ref declares, not what a database has, and names `prisma migration status --to <ref> --db <url>` for the comparison.

### `migration ref policy set <ref>`

| Flag | Values | Writes |
|---|---|---|
| `--change <strategy>` (repeatable) | `migrate`, `reconcile` | `policies.change`, replacing the whole list |
| `--data-loss <level>` | `forbidden`, `with-consent`, `permitted` | `policies.dataProtection.dataLoss` |
| `--access-widening <level>` | `forbidden`, `with-consent`, `permitted` | `policies.dataProtection.accessWidening` |

- At least one flag is required.
- A level is accepted in the short form or in the long form of its own setting (`forbidden` or `data-loss-forbidden` for `--data-loss`). The long form of the other setting is rejected. The file always stores the long form. The short forms are derived from the framework's level lists, not written out again.
- `change` is stored without repeats, in the order `migrate`, `reconcile`. Help says the list replaces the declared one, so `--change reconcile` alone means reconciliation only.
- The closing line says no database was changed, that a database takes on the policies only when its owner applies them in a deploy to that ref, that until then deploys to that ref refuse while the database's policies differ, and that `migration plan --to <ref>` now checks plans against a setting that became `forbidden`, or no longer checks plans against one that was `forbidden`. `migration plan` refuses only for a `forbidden` level, so other changes get no plan sentence. It does not name the consent flag.

### `migration ref policy delete <ref> <setting>...`

- A setting is named as the output names it (`change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`) or by its flag name (`data-loss`, `access-widening`). At least one is required.
- When the last key in `dataProtection` or `policies` is removed, that object is removed too.
- The closing line says no database was changed and that deploys to that ref no longer compare the removed settings with the database. When a removed setting was `forbidden`, it also says `migration plan --to <ref>` no longer checks plans against it, in the same words `set` uses.

### How a change is labelled

Each changed setting is printed with its value before and after and one label. The comparison uses the setting's effective value: what the ref declares, or ADR 320's default (`change: migrate, reconcile`; both levels `with-consent`) when it declares nothing. A default value is printed with "(default)".

- A level: `forbidden` is stricter than `with-consent`, which is stricter than `permitted`. A stricter value `tightens`, a more permissive one `loosens`.
- `change`: adding any strategy `loosens`. Removing strategies without adding any `tightens`.
- A `delete` is labelled only `loosens` or `unchanged`: once a setting is not declared, `migration plan --to <ref>` stops checking it and deploys stop comparing it, so nothing gets stricter. It `loosens` when the deleted value was stricter than the default, and is `unchanged` otherwise.
- An equal effective value is `unchanged`, for example declaring the default for a setting that declared nothing, or deleting a setting that declared the default. Such a change still changes what the file declares, so the file is written and the change is listed in `changes`. Only a command whose declared values would all stay the same is a no-op.

### Output and exit codes

- Human output goes to standard error, one line per setting (`setting:  before  →  after  effect`). It is not drawn as a table, because the CLI engine's table block would need a lint suppression here and the repository forbids those. Standard output carries one `setting<TAB>value` line for each setting the ref declares after the command, with `change` written as `migrate,reconcile`. Settings not declared are left out.
- `--json` returns one shape for all three: `{ ok, ref, policies, changes }`. `policies` is always present, as `{ change, dataProtection: { dataLoss, accessWidening } }` with `null` for a setting not declared. `changes` is a list of `{ setting, before, after, effect }`, where `before` and `after` are the declared values or `null`, and `effect` is `tightens`, `loosens` or `unchanged`. It is empty for `show` and for a command that changed nothing.
- Exit codes are 0 and 2, as for the other ref commands.

### Checks and failures

- Arguments are checked before the file is read. Bad arguments fail with `CLI.INVALID_ARGUMENTS`, naming the allowed values.
- The ref must exist. A missing ref fails with `MIGRATION.UNKNOWN_REF`.
- `head` is refused with `CLI.INVALID_ARGUMENTS` ("The head ref cannot declare policies"): it is a ref the CLI maintains, not one a team declares policies for. Its next action asks for a ref the team keeps for a database, and does not point to `migration ref list`, which lists `head` too.
- They read and write only the named ref file, with the existing `readRef` and `writeRef`. They do not load the migrations or the other refs, so an invalid other ref or an empty migrations directory does not stop them. An invalid ref file fails with `MIGRATION.INVALID_REF_FILE` and is not written.
- A `set` or `delete` that would change nothing exits 0, says nothing changed, and does not write the file.
- A write uses the format every ref writer uses: two-space JSON, keys in the order `hash`, `invariants`, `policies`, and inside `policies` the order `change`, `dataProtection` (`dataLoss`, `accessWidening`). Top-level keys the format does not define are dropped, as every ref writer drops them today.
- Failure state: the file is written once, atomically, after every check has passed. A command that fails leaves the file as it was.

### Help text

The group description defines a ref, the change policy and the data protection policy, says that "policy" here is not the control policy of a database object, and says a database takes on a ref's policies only in a deploy its owner gives consent to, pointing to `prisma db migrate --help` for how. The `set` and `delete` descriptions say: a refused deploy or plan is not a reason to loosen a ref's policies; change them only when the team means to change how that database may change, and have the change reviewed like code.

`migration ref list` shows each ref's declared policies in its human table. Its data lines and `--json` do not change.

## Changes to existing advice

`MIGRATION.POLICY_MISMATCH` today advises "Make the ref match the database, or have whoever owns the database apply the ref's policies." When the database is stricter than the ref, matching it tightens the ref, which is safe. When the database is looser, matching it loosens the ref, which this design forbids advising. The advice is chosen per difference, using the same comparison as the labels:

- Where moving the ref to the database's value tightens the ref: "Make the ref declare what the database has, and have the change reviewed."
- Otherwise, including two `change` lists where neither is a subset of the other: "Have whoever owns the database apply the ref's policies in a deploy."

A mismatch with differences of both kinds gives both sentences, each starting with the settings it covers ("For dataProtection.dataLoss: …").

`MIGRATION.DATA_PROTECTION_FORBIDS` used to end a refusal by a ref with "To do it anyway, whoever owns that database must first change the data protection policy <ref> declares." That describes loosening the ref to get past the refusal, so a refusal by a ref now ends with the recoveries for the refused operations. A refusal by the database's own recorded policy keeps its closing sentence, because that policy changes only in a deploy its owner gives consent to.

## Where the code goes

- All new code is in the CLI package (`packages/1-framework/3-tooling/cli`): the three commands under `src/orm/ref/policy/`, their operations in `src/control-api/operations/`, the short-to-long mapping and the strictness comparison, which `POLICY_MISMATCH` also uses. Validation reuses `parseDeclaredDatabasePolicies`.
- The operations are not exported from the package's public control API. A pipeline only deploys (ADR 320), so a program has no reason to rewrite a ref's policies.
- No change to `packages/1-framework/3-tooling/migration` or `framework-components`.
- The group is declared in `src/orm/cli.ts` (`BIN_GROUPS`), and the commands are registered in `src/orm/family.ts` and mounted in `createBinCommands` in `src/orm/cli.ts`.

## The `prisma` CLI

The `prisma` binary in prisma/prisma-cli mounts each ORM command by name and owns the group text (`packages/cli/src/cli.ts`). A second pull request there mounts the three commands, declares the `migration ref policy` group with the same help and the same warning, updates the `migration ref` brief and the mount tests. It needs an ORM release that contains the first pull request. Until then the commands run only through the ORM's own binary.

## What changes in recorded decisions and docs

- A new short ADR amends ADR 320. Its sentence "Only a person editing the file changes it" becomes: a person changes it, by hand or with these commands, and no command changes a ref's policies as a side effect of doing something else. Its statement that every ref writer keeps the fields it does not change becomes: keeps the fields the ref format defines. The new ADR gives the reasons in the Decision section above. ADR 320 gets only a pointer to it.
- The `prisma-8` skill documents the commands next to the ref file format, names them as well as hand edits in its "never loosen" guidance, lists them in its routing triggers, and its error tables (`migrations.md`, `debug.md`) carry the new `POLICY_MISMATCH` advice.
- `docs/reference/error-reference.md` carries the new advice.
- The glossary entry for a ref, the CLI README's output table, the CLI subsystem doc's command list, `docs/architecture docs/subsystems/7. Migration System.md`, the migration model doc and the project spec's line on who changes a ref's policies mention the `policies` field and the commands.

## Tests

- Each command: the whole file text after a write is compared, so key order and formatting are checked; other fields are kept; an unknown top-level key is dropped; a no-op does not write; bad values, a cross-setting long form, an empty `set` or `delete`, a missing ref, `head` and an invalid file each fail with the stated code and leave the file unchanged.
- `set` with no `--change` flag, which gives the handler no `change` value at all.
- A command succeeds when another ref file is invalid and the migrations directory is empty.
- The labels, for each setting: tighten, loosen and unchanged, from a declared value and from nothing declared.
- `--json` shapes for all three, including `null` settings and an empty `changes`.
- No output of the three commands contains `--permit-policy-change`.
- `migration ref delete staging data-loss` (the word `policy` missing) fails and leaves the ref in place.
- `POLICY_MISMATCH` advice for a looser ref, a stricter ref and both at once.
- A source check: no file under `packages/*/src` other than the command files and the group text contains `ref policy`.
- One journey on PGlite: `policy set` a stricter policy, `db migrate --to <ref>` refuses with `MIGRATION.POLICY_MISMATCH`, the same with `--permit-policy-change` succeeds, and `migration status --to <ref>` reports agreement.
- Manual QA runs an agent against a refused deploy twice, once with the skill installed and once with only the CLI's help, to see whether it reaches for these commands. This is not a committed test.

## Non-goals

- Changing a database's policies. That stays a deploy given consent.
- A programmatic API for rewriting a ref's policies.
- Keeping unknown top-level keys or hand formatting on rewrite. Every ref writer has this behaviour today, and changing it is a change to the ref file writer. It is recorded as a follow-up in the project's design, together with the writer's temporary file name, which uses only the time and can collide between two processes.
- Composer. It refuses refs that declare policies until its own work on policies ships.

## Alternatives considered

- **Policy flags on `migration ref set`.** Rejected: it gives `ref set` a second job with different checks, and a contract argument that is only sometimes required. An agent sent to `ref set` while recovering from a refusal would also see how to loosen a policy.
- **One command, `migration ref policies <name>`, with a `--unset <setting>` flag.** Rejected: the noun needs a read and two writes, and the CLI's convention is one verb per action under a singular noun group.
- **`unset` as a flag value or as a verb.** Rejected: `delete` is the CLI's existing verb for removing what a command targets.
- **Compound actions on `ref` (`ref show-policy`, `ref set-policy`).** Allowed by the command principles, but the newer commands (`service domain add`, `project env update`) use a nested noun.
- **A comma-separated `--change`.** Rejected for a repeatable flag, as `--delete`, `--rename` and `--allow` already are.
- **A label `declared` for a setting not declared before.** Rejected: declaring `permitted` where nothing was declared loosens the effective policy, and the label would hide it.
- **A new function in the migration package that edits the raw JSON and keeps unknown keys.** Rejected for this change: it would make these commands behave differently from every other ref writer.
- **Exporting the operations from the control API, as the other ref commands are.** Rejected, see "Where the code goes".
