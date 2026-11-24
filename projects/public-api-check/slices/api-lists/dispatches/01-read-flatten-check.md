# Dispatch 1: read, flatten, check, commit the lists

Issued 2026-11-24 to the implementer (Opus, medium effort), before the slice files existed. This is a record of that brief, shortened. Slice spec: [../spec.md](../spec.md).

## Outcome

Every published package has a committed `api.txt`, written by `pnpm api:update` and checked by `pnpm api:check` in CI's `Lint` job, such that the lists are a deterministic function of the build output and no published package's source or `exports` changes.

## Inputs

- `projects/public-api-check/spec.md`, section "The list: `api.txt`".
- Trial scripts: `wip/api-check-spike/gen-model.mjs`, `flatten.mjs`.

## Requirements beyond the trial scripts

- A non-exported type is listed once per package, marked `(not exported)`, with no path prefix.
- Forwards, default exports and `declare module` augmentations are read with the TypeScript compiler API; an augmentation's line does not repeat `readonly`.
- Member lines say required or optional, and readonly, static, abstract or protected where they apply. No private members. Overloads give distinct lines. A deprecated item gets an extra line.
- Sorted with a locale-independent comparison; byte-identical across runs and machines; no paths, hashed chunk names or line numbers.
- Two different items that give the same line fail the script.
- The `.api.json` output is kept in a gitignored, documented location.
- The lists are not published, not linted or formatted, not marked `linguist-generated`, and are on the search tools' ignore lists.
- A short contributor note: what `api.txt` is, that CI fails when it is stale, and that `pnpm api:update` after `pnpm build` fixes it, including after a merge conflict.

## Edge cases

| Case | Disposition |
| --- | --- |
| Committed `exports` out of date with the build | Report, do not fix. |
| The design proves wrong or impossible | Stop and report; do not redesign. |
| Destructive git operations | Forbidden without the orchestrator's approval. |

## Completed when

- Tests for the flattener were written first and each can fail.
- The slice's own test files, lint and typecheck for the touched files, `pnpm lint:deps`, `pnpm check:clean-tree` and `pnpm api:check` pass.
- No whole test suite was run.
- Commits are small, staged by path, signed off twice, not pushed.
- The report gives run time, sizes, the longest lines, whether union ordering varied, and what was not verified.
