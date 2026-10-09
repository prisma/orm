# Brief: slice 4, migration files write template literals (TML-3290)

You implement slice 4 of the project "SQL expression literals". You work in the git worktree at the current directory, on branch `tml-3290-migration-files-template-literals`, which starts from the tip of slice 1's branch (`tml-3287-line-comments-in-raw-sql`, pull request #30546). Treat this directory as the repository root; do not read, write or run anything above it. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files. Run node, pnpm and git through `mise exec --`.

The project files are not on this branch and live outside this worktree, so this brief carries everything you need; the design section is copied below.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`, then the rules it lists under Testing and TypeScript & Typing.
2. `wip/slice-1-brief.md` section 14, for `OpaqueSql` and `renderOpaqueSql`, which slice 1 added and which the sites below now read through `.text`.
3. `packages/1-framework/1-core/ts-render/src/ts-string-literal.ts`, `json-to-ts-source.ts` and `index.ts`; `packages/1-framework/3-tooling/migration/src/migration-ts.ts` (prettier with `singleQuote: true`); `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (`renderDdlColumnDefault` line 165, `renderDdlConstraintAsTsCall` line 183, `AddCheckConstraintCall` line 1110, `CreateIndexCall` line 1197, `CreatePostgresRlsPolicyCall` line 1751 and its `input: RenderedRlsPolicyLiteral` at line 1784) and the SQLite twin `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` (`renderDdlColumnDefault`).
4. ADR 195 (`docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md`) and `docs/architecture docs/subsystems/7. Migration System.md`.

## Outcome

A newly generated `migration.ts` writes a single-line SQL text that holds both quote kinds as an untagged template literal, so no quote is escaped. No migration function, type or import changes; `ops.json` is unchanged; committed migration files are not regenerated (`pnpm migrations:regen:examples` produces no diff).

## Design (project design.md section 16, checked against the branch on 2026-09-30)

Generated `migration.ts` files are formatted by prettier with `singleQuote: true`, which already picks the quote that avoids escaping. A SQL body keeps escaped quotes only when it holds both `'` and `"`, for example `"kind" IN ('admin', 'user')`.

Add to `packages/1-framework/1-core/ts-render/src/ts-string-literal.ts`, exported from the package entry (`src/index.ts`):

```ts
/**
 * TypeScript source for a string: an untagged template literal when the text holds both quote kinds and no line
 * break, so neither quote is escaped; otherwise `tsStringLiteral(text)`.
 */
export function tsQuotedTextSource(text: string): string;
```

When `text` contains `'` and `"` and none of `\n`, `\r`, U+2028 or U+2029, it returns `` `\`${escaped}\`` `` where `escaped` replaces `\` with `\\`, then `` ` `` with `` \` ``, then `${` with `\${`. Otherwise it returns `tsStringLiteral(text)`. Biome's `style/noUnusedTemplateLiteral`, which lints committed example migrations, does not report a template that holds a quote; confirm that with `pnpm lint` after the change.

Add to the same package, next to `jsonToTsSource`, and export it from `ts-render/src/index.ts`:

```ts
/** An object literal from entries whose values are already TypeScript source, laid out as `jsonToTsSource` lays out objects. */
export function tsObjectSource(entries: readonly (readonly [key: string, source: string])[]): string;
```

It returns `{}` for no entries; otherwise it renders each entry as `` `${renderKey(key)}: ${source}` `` and returns the one-line form when it is at most 80 characters and has no line break, else the multi-line form with two-space indentation and a trailing comma. `jsonToTsSource`'s object branch calls it, so its output is unchanged for every existing input.

Sites that print a SQL text field with `tsQuotedTextSource` in place of `jsonToTsSource` or `tsStringLiteral`:

- `renderDdlColumnDefault` (both targets): `fn(${tsQuotedTextSource(def.expression.text)})`.
- `renderDdlConstraintAsTsCall` (Postgres): `checkExpression(${jsonToTsSource(name)}, ${tsQuotedTextSource(c.expression.text)})`.
- `CreateIndexCall.renderTypeScript` (Postgres): `expression: ${tsQuotedTextSource(this.expression ?? '')}` and, in `extras`, `where: ${tsQuotedTextSource(this.where)}`.
- `AddCheckConstraintCall.renderTypeScript`: `expression: ${tsQuotedTextSource(this.expression)}`.
- `CreatePostgresRlsPolicyCall.renderTypeScript`: keep building `input` typed as `RenderedRlsPolicyLiteral`, then print `policy: ${tsObjectSource(entries)}` where `entries` are `Object.entries(input)` without `undefined` values, in `input`'s key order, with `using` and `withCheck` rendered by `tsQuotedTextSource` and every other value by `jsonToTsSource`.

No migration function, type or import changes. Rendered SQL is unchanged, so `ops.json` is identical, and committed migration files are not regenerated. A file, line or function that moved: correct this brief's copy in your report and continue. A difference in behaviour or in a type the design depends on: stop and write it to `wip/slice-4-findings.md` with your recommendation, then report.

## Tests (each fails if the behaviour it names is removed; write them first)

- `ts-render/test/ts-string-literal.test.ts`: `tsQuotedTextSource` for text with both quote kinds (template), one quote kind, no quote, a line break, U+2028 (string literal), and a backtick, a backslash and `${` inside a template.
- `ts-render/test/json-to-ts-source.test.ts` (update): `tsObjectSource` layout rules; `jsonToTsSource` output unchanged for objects.
- Postgres target `test/migrations/op-factory-call.test.ts` and `op-factory-call.lowering.test.ts` (update): exact output for `CreateTableCall`, `AddColumnCall`, `CreateIndexCall`, `AddCheckConstraintCall` and `CreatePostgresRlsPolicyCall` with a both-quote-kinds text.
- SQLite target `test/migrations/render-typescript.test.ts` (extend, added in slice 1): a default holding both quote kinds renders as a template literal.
- Postgres and SQLite adapter `render-typescript.roundtrip.test.ts` (update): include a both-quote-kinds CHECK, policy predicate and index `where`; the written `ops.json` equals `renderOps(calls)`.
- `pnpm migrations:regen:examples` produces no diff (run it and check `git status`).

## Docs and upgrade instructions

- `docs/architecture docs/subsystems/7. Migration System.md`: a short paragraph in the section on migration files saying a single-line SQL text holding both quote kinds is written as an untagged template literal, and why (prettier already picks the quote otherwise).
- Upgrade fragment `upgrade-instructions/pending/migration-files-template-literals/extension/instructions.md` with `changes: []` and one paragraph, if `pnpm check:upgrade-coverage` requires a fragment because a file under `examples/` or `packages/3-extensions/` changed; otherwise no fragment. Say in your report which case applied.

## Rules

- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (`pnpm test <path>` in the package); no `any`; no bare `as` in production code; no file extensions in imports; no comments unless the code cannot say it (the two doc comments above document exported surface); no re-exports outside `exports/` or `index.ts` entries; test names omit "should"; whole-shape assertions; `pnpm lint:deps` must pass.
- Markdown prose is never hard-wrapped: one paragraph per line.
- After changing exported types in a package, build it before typechecking downstream.

## Verify

Each once, output saved under `wip/s4/` and read from the file: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm migrations:regen:examples` (then `git status --short` must be empty apart from your own uncommitted work), `pnpm test:packages`, and `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing. In `test/integration`, run only the migration-file journeys: `pnpm test test/cli-journeys/expression-index-migration test/cli-journeys/rls` and any file whose imports you change. **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full; the Bash hook blocks them.** Known local failures to report but not fix: the three publish-shell tarball tests. Rerun any other failing test file alone once.

## Commits

- Small commits, each one step, explicit `git add <paths>`. This brief lives in the gitignored `wip/` folder; do not commit it.
- `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit. Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Report in plain English, in short sentences: what you built, each verification result with its log path, whether `migrations:regen:examples` produced a diff (it must not), whether a fragment was required, and anything you could not do.
