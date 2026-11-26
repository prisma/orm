# Slice: the author writes one list of required capabilities

The operator settled this on 2026-11-27 ([plan.md](plan.md), "Direction settled on 2026-11-27"; the reasoning is in [terminology-review.md](terminology-review.md)). It reworks the authoring option this branch built. This brief is our best effort: the purpose is fixed, the mechanism is open. If the code shows part of it is wrong or a simpler way exists, say so with the evidence, and do not build something you believe is wrong.

## Why

Capabilities are dependencies: a database version or a connection provides them, and a contract requires them. Today the author writes `databaseVersion: 17` and an optional `capabilities` list with a hidden default (the default driver's set). A user whose client then reports a missing capability never wrote it and cannot see where to remove it. The names also hide the direction: "the contract's capabilities" reads as what the contract can do.

## Outcome

- The author writes one list, and everything the contract requires is in it:

  ```ts
  defineContract({
    requiredCapabilities: [...postgres17, ...postgresDriver],
    // models…
  })
  ```

  and, for a Prisma schema, in the config's contract entry: `contract: { path, requiredCapabilities: [...postgres17, ...postgresDriver] }`. The same for the Prisma 7 schema provider and for `postgresContractCapabilities` (rename or reshape it as fits; a config built without the facade passes the same list).
- `databaseVersion` and the `capabilities` option are removed, with `defaultConnectionCapabilities`. No backward-compatible aliases.
- The list must be present and not empty. That is the only check. The refusal shows no example.
- A capability in the list is a key string as the messages print it today (`sql.returning`, `postgres.distinctOn`, `sql.interactiveTransactions`). The PostgreSQL package exports one readonly tuple of keys per supported version (`postgres15` to `postgres18`), built from the target's table, and `postgresDriver` from the driver's declared set. An author removes a capability by filtering or by writing the keys out. Choose the public entrypoint by the package's existing export conventions (`pnpm lint:deps`, the `exports/` folders) and say which you chose.
- The contract's type still knows each capability literally, so type-level checks (`transaction()`, locking, `StackProvides`) keep working from a list written with spreads of `as const` tuples.
- `contract.json` keeps its current `capabilities` nested object and its current key names. Renaming the stored field and prefixing keys by provider is the next pull request, not this one.

## Messages (wording settled; keys print as they are today)

- **Required but not provided, client** (`CONTRACT.CAPABILITIES_NOT_PROVIDED`):

  > Your contract requires `sql.interactiveTransactions`, which this client's connection does not provide. Remove it from your contract's required capabilities, or connect with a driver that provides it.

  With several keys, list them and use the plural. The type error's property name becomes `<key> is required by the contract but not provided by this client's connection`.
- **Required but not provided, database** (the framework's rendering of the refusal): keep the first sentence as it is. The second sentence becomes: `Either upgrade the database, or remove them from your contract's required capabilities.` The "state version 15" advice goes, and with it `matchingVersion` if nothing else reads it.
- **Unavailable feature** (`ORM.CAPABILITY_MISSING` and every other place that reports a feature the contract's list does not cover: the ORM client, the Prisma schema interpreter, the PostgreSQL renderer's locking clause, `transaction()`, the Better Auth adapter): one form everywhere, key in backticks with its namespace:

  > `upsert()` is unavailable: your contract declares no dependency on `sql.insertOnConflictTarget`. To enable it, add `sql.insertOnConflictTarget` to your contract's required capabilities.

  A message that today explains why the feature needs the capability keeps that explanation as a middle sentence. Delete `missingCapabilityRemedy` and its sentence. Find every phrasing in the table of finding 6 of the review and any the table missed.

## `init`

`init` must write `requiredCapabilities: [...postgres18, ...postgresDriver]`. The init contribution's contract entry is data (a JSON value, or a call with JSON arguments), and a spread of an imported name is neither. **Do not change `packages/1-framework` for this.** Leave `init` writing what it writes now if that still compiles, or report exactly what it needs; the orchestrator is asking the operator.

## Stale text to fix in the same change

- `packages/3-extensions/sql-orm-client/README.md`, the `onConflict: 'skip'` section: "The runtime adds the adapter's capabilities to the contract…" is no longer true.
- Doc comments in `packages/2-sql-family/2-authoring/contract-ts/src/contract-definition.ts`, `contract-dsl.ts` and `contract-types.ts` that say capabilities join "as `prisma contract emit` and the runtime join them".

## Shipped docs you update

READMEs of the touched packages, `docs/reference/error-reference.md`, the upgrade instructions and the upgrade skill, and the subsystem docs that show the option. Write "provides" for a database version or a connection and "requires" for a contract. The orchestrator writes the spec, the plan, the glossary, the ownership rule and the ADRs; leave those.

## Rules for the work

- Tests first. Read `CLAUDE.md` and `.agents/rules/` for the repository's rules (no `any`, no bare `as`, no comments where code can say it, no hard-wrapped markdown, never change `packages/1-framework`).
- **The machine is shared by many agent sessions, and it crashed on 2026-11-26 when several ran heavy commands at once.** So every build, install, typecheck, lint of more than one package, `api:*` command and test runs as `lockf -t 3600 /Users/will/Projects/prisma/orm/.claude/heavy-command.lock <command>`. Reading, searching, editing and git need no lock.
- For the same reason, never run a whole test suite or a whole-repository check locally. Run the test files you touched, plus typecheck and lint for the packages you touched. CI runs everything. `pnpm build` (needed after changing exported types) and one `pnpm fixtures:emit` at the end are allowed, each under the lock, each once where possible. Save long output to a file under `wip/` and read the file; never use `/tmp`.
- Stay inside this worktree. Do not push. Commit in small steps with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, staging files by name, each message ending `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Report back

What you built and where it differs from this brief, with reasons; the public entrypoint you chose; what `init` needs; which checks you ran and their results; anything you found wrong and did not fix.
