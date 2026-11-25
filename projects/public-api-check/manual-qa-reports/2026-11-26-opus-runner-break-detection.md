# Manual QA: the checks against the last release (2026-11-26, Opus runner)

Script: `projects/public-api-check/manual-qa-break-detection.md`. Branch `tml-3933-break-detection` at `0934f6f437`. Last release on the registry: `8.0.0-rc.25`. Steps 8 to 10 (on a real pull request) were not run here; the orchestrator runs them. Scratch files and full logs are under `wip/qa/` (gitignored).

## Results

| Step | Result |
| --- | --- |
| 1. Setup | Pass |
| 2. A break in source | Pass (see Q01, Q03) |
| 3. Recording it | Pass (see Q04) |
| 4. Undoing it | Pass (see Q02, Q06) |
| 5. A compatible change | Pass |
| 6. The example apps | Pass (see Q05) |
| 7. The guide | Pass (see Q07) |
| 11. Cleanup | Pass |

## Steps

### Setup

`pnpm install --frozen-lockfile`, then `pnpm build`: exit 0, 105 of 105 tasks.

### 1. Setup

- `git status`: clean.
- `pnpm api:check`: `api:check: all 22 lists match the build`, exit 0.
- `pnpm api:compat --only @prisma/orm-extension-middleware-cache`: exit 0.

```text
api:compat: last release 8.0.0-rc.25; a pre-release, so breaks are reported and do not fail
@prisma/orm-extension-middleware-cache: 16 exports on 1 paths; 16 comparisons, ...; breaks 0, undecided 0, not compared 0, recorded 0
```

Pass.

### 2. A break in source

Changed `options?:` to `options:` in `createCacheMiddleware` in `packages/3-extensions/middleware-cache/src/cache-middleware.ts`.

`pnpm build`: exit 1. 104 of 105 tasks succeeded; `retail-store#build` failed with `src/db.ts(10,18): error TS2554: Expected 1 arguments, but got 0.` The public package built (see Q03).

`pnpm api:compat --only @prisma/orm-extension-middleware-cache`: exit 0.

```text
api:compat: last release 8.0.0-rc.25; a pre-release, so breaks are reported and do not fail
@prisma/orm-extension-middleware-cache: ... breaks 1, undecided 0, not compared 0, recorded 0
  break (reported only)  @prisma/orm-extension-middleware-cache: createCacheMiddleware (value): Type 'undefined' is not assignable to type 'CacheMiddlewareOptions<TMeta>'.
    to record it: {"path":".","export":"createCacheMiddleware","test":"value","kind":"break","lastRelease":"8.0.0-rc.25","fingerprint":"b0e322358c4a297e","reason":"…"}
```

The same with `--ga`: exit 1, the same break without "(reported only)", and the package line ends `— FAILS`. The header line still says "a pre-release, so breaks are reported and do not fail" (Q01).

The break line names the root path only by the bare package name; the printed record has `"path":"."`. Pass.

### 3. Recording it

Following the guide: `pnpm api:update` (1 of 22 lists changed, the middleware-cache `api.txt`), then `--ga` again to get the record printed against the updated list. Its fingerprint changed from `b0e322358c4a297e` to `69c304d3be3ab44c`, as the guide warns (Q04). Pasted that record, with a reason, into `packages/9-public/@prisma/orm-extension-middleware-cache/api-breaks.json`.

`pnpm api:compat --only @prisma/orm-extension-middleware-cache --ga`: exit 0.

```text
@prisma/orm-extension-middleware-cache: ... breaks 0, undecided 0, not compared 0, recorded 1
  recorded break  @prisma/orm-extension-middleware-cache: createCacheMiddleware (value): QA: options become required; see the release notes
```

Pass.

### 4. Undoing it

Reverted the source with `git checkout`, `pnpm build` (105 of 105), and ran with `--ga`, record kept: exit 1.

```text
@prisma/orm-extension-middleware-cache: ... breaks 0, ... recorded 0 — FAILS
  problem  . createCacheMiddleware (value): the recorded break is no longer a break. Remove the record.
```

Same result after `pnpm api:update` restored `api.txt`. Same result, exit 1, without `--ga` (Q02). Removed the record. Pass.

### 5. A compatible change

Added `_qaExtra?: { readonly label?: string }` as a second parameter. `pnpm build`: 105 of 105. `--ga`: exit 0, `breaks 0`. Reverted and built (105 of 105). Pass.

### 6. The example apps

`pnpm api:compat:examples --only prisma-8-demo`: exit 0, `prisma-8-demo: 0 errors in 0 files`.

At tag `v8.0.0-rc.25`, `examples/prisma-8-demo/test/codec-id-ergonomics.types.test-d.ts` line 14 asserts `db.raw.sql\`now()\`.returns('pg/timestamptz-temporal@1')` has `returnType.codecId` equal to the literal. Widened the result of the contract-bound `returns(spec: S)` in `packages/2-sql-family/4-lanes/sql-builder/src/types/raw-query.ts` to `codecId: string`. `pnpm build`: 105 of 105.

`pnpm api:compat:examples --only prisma-8-demo --ga`: exit 1.

```text
api:compat:examples: last release 8.0.0-rc.25 (tag v8.0.0-rc.25); an error fails unless it is recorded
prisma-8-demo: 1 error in 1 file (recorded: 0 allowed, 0 breaks); 2.9 s — FAILS
  test/codec-id-ergonomics.types.test-d.ts: 1
    test/codec-id-ergonomics.types.test-d.ts(14,55): TS2344 Type '"pg/timestamptz-temporal@1"' does not satisfy the constraint '"Expected: literal string: pg/timestamptz-temporal@1, Actual: string"'.
```

`git status -- examples`: no change. Reverted and built (105 of 105). Pass.

### 7. The guide

Read `docs/Public API Compatibility.md` in full. Ran `run()` from `.github/workflows/scripts/api-changes.mjs` in a dry run (`wip/qa/api-changes-dry.mjs`, with stubbed GitHub requests) over a changed `createCacheMiddleware` line, an added export and an added `api-breaks.json` record, for four descriptions:

- No section: fails; says to add `## API changes`, lists the three names to use (two exports and the package, for the record), explains that a package name covers its changes, and gives an example. One comment is posted with the diff per file and a section to copy.
- Section naming only one export: fails and lists the two missing names.
- Names with no reason: fails and lists them under "named on a line that gives no reason".
- The package name with a reason: passes.

Each failure in steps 2 to 7 says what is wrong and what to do, and the guide covers each one. Pass, with the small points in Q04 to Q07.

### 11. Cleanup

All source changes reverted; the record file removed. `pnpm build`: 105 of 105. `pnpm api:check`: `all 22 lists match the build`. `git status`: clean before this report.

## Findings

### Q01: with `--ga`, the header still says breaks do not fail

What I did: `pnpm api:compat --only @prisma/orm-extension-middleware-cache --ga` with a break present.

What happened: the first line says "last release 8.0.0-rc.25; a pre-release, so breaks are reported and do not fail", and then the package line says `— FAILS` and the run exits 1. `scripts/public-api/api-compat.mjs` line 239 picks the wording from the version alone and ignores `--ga`. `api-examples.mjs` gets this right ("an error fails unless it is recorded").

What I expected: with `--ga`, the header says breaks fail unless recorded, as the examples script does.

### Q02: an outdated record fails a pre-release run, which the guide does not say

What I did: ran `pnpm api:compat --only @prisma/orm-extension-middleware-cache` without `--ga`, with a record for a break that no longer exists.

What happened: exit 1 with "the recorded break is no longer a break. Remove the record.", under a header that says breaks "are reported and do not fail".

What I expected: probably this behaviour, since a stale record is a mistake in the pull request, not a break. But the guide's table says the type tests only "Report" before `8.0.0`, and "Reports means the job lists what it found ... and passes". The guide should say that a record that no longer matches fails at any version.

### Q03: the script's step 2 build fails, because an in-repo example calls the function with no arguments

What I did: made `options` required and ran `pnpm build`, as step 2 says.

What happened: `examples/retail-store` fails to type-check (`src/db.ts(10,18): TS2554`). The public package still built, so `api:compat` ran correctly.

What I expected: the script to say the build fails in `retail-store` and that this is expected, or to pick a break no in-repo code depends on. A contributor would meet the same failure, which is correct: it is the break.

### Q04: a record printed before `pnpm api:update` carries a fingerprint that later stops matching

What I did: ran the check right after building the break (step 2), then ran `pnpm api:update` and the check again.

What happened: the printed fingerprint changed from `b0e322358c4a297e` to `69c304d3be3ab44c`, because the fingerprint is taken from `api.txt`. The guide says to run `pnpm api:update` before copying a printed record. The tool output does not say so, and does not notice that `api.txt` is out of date with the build. I did not test what happens when the first fingerprint is pasted.

What I expected: the check to warn, next to "to record it", when the package's `api.txt` does not match the build, since a contributor reads the output and pastes, often without rereading the guide.

### Q05: the example-app check prints no record to paste

What I did: step 6, the failing example app.

What happened: the report gives the file, line, code and message, but no ready record. The type-test check prints one under each break.

What I expected: a `to record it:` line in the same form as `api:compat`, so a contributor does not assemble `app`, `file`, `line`, `code`, `message` and `lastRelease` by hand, where a typo in the message makes the record match nothing.

### Q06: the outdated-record line does not name the file to edit

What I did: step 4.

What happened: `problem  . createCacheMiddleware (value): the recorded break is no longer a break. Remove the record.` The line uses `.` for the path, while break lines use the package name, and it does not name `api-breaks.json`.

What I expected: the same `package: export` form as break lines, and the file path, for example "Remove the record from packages/9-public/@prisma/orm-extension-middleware-cache/api-breaks.json". Minor: the package header above the line already identifies the package.

### Q07: the failure message's example is not in a code block

What I did: step 7, the dry run.

What happened: the message ends with "For example:" followed by a bare `## API changes` and list. The message also goes into the job summary under "## Description check", where that example renders as a real heading.

What I expected: the example in a fenced `markdown` block, as the comment's own template already is.
