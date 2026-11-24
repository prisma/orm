# Slice: the committed API list of each published package

Parent project: [`projects/public-api-check/`](../../spec.md). Linear: [TML-3932](https://linear.app/prisma-company/issue/TML-3932). One pull request.

## At a glance

Each of the 22 packages under `packages/9-public/@prisma/` gets a generated, committed `api.txt` beside its `package.json`. It has one line per import path, export and member, with the full signature. `pnpm api:update` writes the files, `pnpm api:check` fails when a committed file differs from what the build gives, and CI's `Lint` job runs the check.

## Chosen design

The project spec's sections "One reading of each package's exports, three uses" and "The list: `api.txt`" are the design. In short:

- API Extractor's doc model is generated once per key of each package's `exports`, from the built `.d.mts`, in parallel worker processes. The `.api.json` output is kept in each package's gitignored `dist-api/`. It is only half of the reading: what each path exports is decided by the TypeScript compiler, and the two are joined inside the list generator.
- A flattener prints the model as sorted lines. Forwarded paths, default exports and `declare module` augmentations are read with the TypeScript compiler API, because the doc model omits them.
- A type that a signature uses but that is not exported is listed once per package, marked `(not exported)`.
- Output is byte-identical on every run and machine.

## Coherence rationale

One reviewer can hold it: two scripts (read, flatten), their tests, two `package.json` commands, one CI step, a contributor note, and 22 generated files that are reviewed by sampling. Nothing in a published package's source or `exports` changes.

## Scope

**In:** `scripts/` (the two scripts and tests), root `package.json` (commands, `test:scripts`, dev dependencies), the lockfile, `.github/workflows/ci.yml` (`Lint` job), ignore lists so the lists are neither linted nor flood searches, the 22 `api.txt` files, and a short note in the onboarding docs.

**Deliberately out:** any comparison with a release or with the pull request's base; the pull request comment; the description check; `AGENTS.md` and CodeRabbit instructions; the decision record and the policy documentation (they ship with the check that enforces the policy); any change to a package's `exports` or source; `packages/1-framework`.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| API Extractor renames clashing names with `_N`, and the bundler with `$N` | Lines use stable names as the trial did; covered by a test. |
| Two different items give the same line | The script fails with a clear message. |
| An inferred union type prints in a different order between builds (microsoft/rushstack#1958) | Measured in this slice; reported, not solved, unless it occurs. |
| A package's committed `exports` is out of date (the build writes it only outside CI) | Reported, not fixed. |
| Destructive git operations by a subagent | Forbidden without the orchestrator's approval. |

## Slice-specific done conditions

- The lists generated in CI equal the committed ones (the `Lint` job passes on the pull request).
- Changing a signature in a built declaration and running `pnpm api:check` fails and names the package.
- Manual QA: N/A for end users (no published package changes). The contributor path (`pnpm build`, change an export, `pnpm api:check` fails, `pnpm api:update` fixes) is run by hand once and recorded.

## References

- Trial scripts and output (gitignored): `wip/api-check-spike/gen-model.mjs`, `flatten.mjs`, `lines/`.
- Spike records: [`../../spikes/`](../../spikes/).
