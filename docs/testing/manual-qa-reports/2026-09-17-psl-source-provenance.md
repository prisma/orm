# Manual QA report — PSL source provenance — 2026-09-17

> **Script:** `docs/testing/psl-source-provenance-manual-qa.md`, commit `793f8ade15d5430bb0d09094441da5f0fcef01bb`
> **Runner:** fresh independent general-purpose QA executor (not implementation/script author)
> **Environment:** Linux; Node v24.19.0; pnpm 10.27.0; branch `multifiile-psl`
> **Started / finished:** 2026-09-17T10:45:45Z / 2026-09-17T10:57:33Z (11m48s including investigation and report assembly)
> **Verdict:** Fail — four fix-in-PR script-usability findings; no product provenance regression observed in supplemental live probes

## Summary

The committed script is not independently executable as written: three of four scripted commands fail before reaching their intended oracle, and cleanup instructions are absent. The live CLI, editor pipeline, extension attribute interpreter, and provider read-error path all satisfy their provenance oracles when exercised by explicitly recorded supplemental invocations. This does not resolve the script findings or constitute PR sign-off. No unit suites, builds, commits, pushes, or PR operations were performed by this runner.

## Pre-flight

`git rev-parse HEAD` printed `793f8ade15d5430bb0d09094441da5f0fcef01bb`; `git status --short` printed nothing. CLI built artifact exists. Builds explicitly forbidden by dispatch because another executor owns shared validation. Scratch root: `/tmp/psl-source-provenance-qa-Di310F`. Scenarios 1–5 are independent tmpdir scenarios; concurrent shell probes capped at five. Per dispatch, read shared checkout/build artifacts without creating a separate unbuilt clone; no source or generated-contract mutations permitted. This is a deliberate isolation-plan deviation from the generic skill, allowed by the script and dispatch.

## Findings

### F-1 — Follow-up — Copied demo cannot resolve dependencies outside the checkout

Scenario 1 exits 2 before parsing. Literal output: `"code":"CONFIG.EVALUATION_FAILED"`, `"why":"Cannot find module 'dotenv/config'\nRequire stack:\n- /tmp/psl-source-provenance-qa-Di310F/scenario-1/prisma.config.ts"`. Oracle requires a scratch PSL diagnostic at the malformed declaration, line 121. The copy contains relative node_modules links that do not resolve at its new location. **Proposed disposition: fix-in-PR**, make scratch dependency setup reproducible in the QA script. Full invocation/output and git state will be preserved in the scenario-1 evidence.

### F-2 — Follow-up — Attribute probe uses obsolete AST/context APIs

Scenario 3 exits 1 with `TypeError: Cannot read properties of undefined (reading '0')` at `const model = document.namespaces[0].models[0];`. It never invokes `interpretAttribute`. Oracle requires `QA_ATTRIBUTE`, scratch filename, and span at `@@qa` (line 4). **Proposed disposition: fix-in-PR**, update the script to actual public typed-AST and provenance-context APIs. Full invocation/output and git state will be preserved in scenario-3 evidence.

### F-3 — Follow-up — Read-error probe cannot execute its top-level await

Scenario 4 exits 1 with `/eval.ts:5:20: ERROR: Top-level await is currently not supported with the "cjs" output format`. Oracle requires a returned `PSL_SCHEMA_READ_FAILED` diagnostic naming the missing path. **Proposed disposition: fix-in-PR**, make the script's async invocation executable by its documented `tsx -e` command. Full invocation/output and git state will be preserved in scenario-4 evidence.

### F-4 — Follow-up — Script provides no Restore or final cleanup steps

Scenarios 1–5 end without a Restore section or scratch-root teardown command. After execution the copied demo, corrupted schema, and diagnostic files remained under `/tmp/psl-source-provenance-qa-Di310F`; the runner must invent cleanup to satisfy the execution protocol. Scenario 1's Oracle additionally says `schema.prisma` while its actual steps create `src/prisma/contract.prisma` (the latter is used for this run's source-location oracle). **Proposed disposition: fix-in-PR**, supply per-scenario Restore/final cleanup and make the filename oracle consistent. Cleanup is executed and verified below, not claimed as a script-provided behavior.

All failures occurred at HEAD `793f8ade15d5430bb0d09094441da5f0fcef01bb`. Concurrent implementation executor had modified migration `aggregate/loader.ts`, `aggregate/strategies/plan-from-diff.ts`, and `aggregate/unclaimed-elements.ts`; this runner had only created this report. These are script usability failures before the product oracles can be reached, not established product regressions. Script remained unmodified; supplemental runs are explicitly identified below.

## Per-scenario log

| # | Scenario | Isolation | Live command wallclock | Result | Findings |
| --- | --- | --- | --- | --- | --- |
| 1 | Malformed copied demo | tmpdir | 2.543s literal; 2.519s supplemental | Literal setup fails; supplemental CLI oracle passes | F-1, F-4 |
| 2 | Unsaved editor buffer | tmpdir | 2.896s | Pass; supplemented by explicit disk-read rejection | F-4 |
| 3 | Extension AttributeCtx diagnostic | tmpdir | 2.515s literal; 2.007s runner import mistake; 3.563s corrected supplemental | Literal obsolete API fails; supplemental oracle passes | F-2, F-4 |
| 4 | Missing/unreadable path | tmpdir | 2.166s literal; 2.679s supplemental | Literal command cannot compile; supplemental read-error oracle passes | F-3, F-4 |
| 5 | Exploratory provenance edges | tmpdir | Approximately 2m including probe design; command batches 2.580s and 2.002s | Bounded charter completed across all four named focus areas; not a full 20-minute soak | F-4 |

Scenarios 1–4 started concurrently at 10:47:24Z; independent supplemental scenarios 1, 3, 4 started concurrently at 10:50:12Z. Exploration ran after their results to probe the remaining ownership/live-buffer edges. The 20-minute charter was treated as a cap and concluded on focus-area completion (the skill permits charter completion before timeout); no claim of a full 20-minute exploration is made. Global dispatch budget was also 20 minutes.

## Evidence and observations

The following files preserve literal invocations, stdout, stderr, process exit, HEAD, `git status --short`, and wallclock. `REPO_ROOT=/Users/sevinf/projects/worktrees/prisma-next/multifile-psl/prisma-next`; `PN_QA_TMP=/tmp/psl-source-provenance-qa-Di310F`. Process captures were executed through Python subprocesses invoking `/bin/bash`; no shell-history facility was available. Tool-policy adaptations only: the scenario-2 heredoc was written through the write tool, and `cat` output inspection was replaced with Python reads; actual CLI/API commands were otherwise copied from the script for literal runs.

| Probe | Full evidence |
| --- | --- |
| Scenario 1 literal | [Command and failure](artefacts/2026-09-17-psl-source-provenance/scenario-1-literal.log) |
| Scenario 1 supplemental | [Command and successful diagnostic oracle](artefacts/2026-09-17-psl-source-provenance/scenario-1-supplemental.log) |
| Scenario 2 literal | [Command and output](artefacts/2026-09-17-psl-source-provenance/scenario-2.log) |
| Scenario 3 literal | [Command and failure](artefacts/2026-09-17-psl-source-provenance/scenario-3-literal.log) |
| Scenario 3 supplemental | [Command and successful diagnostic oracle](artefacts/2026-09-17-psl-source-provenance/scenario-3-supplemental.log) |
| Scenario 3 runner mistake | [Incorrect supplemental exports.ts import, corrected on retry](artefacts/2026-09-17-psl-source-provenance/scenario-3-runner-import-error.log) |
| Scenario 4 literal | [Command and failure](artefacts/2026-09-17-psl-source-provenance/scenario-4-literal.log) |
| Scenario 4 supplemental | [Command and read-error result](artefacts/2026-09-17-psl-source-provenance/scenario-4-supplemental.log) |
| Exploration batch 1 | [Source texts, invocations, positions, ownership results](artefacts/2026-09-17-psl-source-provenance/scenario-5-first.log) |
| Exploration batch 2 | [Disk-read interception and detached same-green root](artefacts/2026-09-17-psl-source-provenance/scenario-5-second.log) |
| Mutated scratch source | [Malformed contract](artefacts/2026-09-17-psl-source-provenance/malformed-contract.prisma.txt) |
| Unchanged editor disk source | [Clean disk schema](artefacts/2026-09-17-psl-source-provenance/unchanged-editor-disk.prisma.txt) |

### CLI source filename and location

Copied dependency inspection printed:

```text
copied dotenv link: True ../../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv exists: False
original dotenv link: True ../../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv exists: True
```

Supplemental setup replaced only scratch `node_modules` with an absolute symlink to the demo's original dependencies, then executed the same CLI with telemetry disabled. The exit remained 2, now for the intended malformed schema. Source oracle from the actual copied file:

```text
119: model Broken {
120:   id Int @id
121:   name
122: }
```

Literal diagnostic excerpt:

```json
{"code":"PSL_INVALID_MODEL_MEMBER","message":"Expected a type after field \"name\"","sourceId":"./src/prisma/contract.prisma","span":{"start":{"offset":2553,"line":121,"column":3},"end":{"offset":2557,"line":121,"column":7}}}
```

A second `PSL_UNSUPPORTED_FIELD_TYPE` diagnostic also names `Broken.name` at exactly `121:3–121:7`. Both are rendered in the structured envelope, with no repository demo path or synthetic filename. No successful emit occurred; no generated contract was edited by the runner.

### Unsaved editor text and no disk reread

Literal scenario 2 printed:

```json
{
  "filename": "/tmp/psl-source-provenance-qa-Di310F/scenario-2/schema.prisma",
  "codes": ["PSL_DUPLICATE_DECLARATION"]
}
```

Supplemental instrumentation replaced `fs.readFileSync`, `fs.readFile`, and `fs.promises.readFile` with throwing functions after module loading and called `syncBuiltinESMExports`. The live `runPipeline` call returned `attemptedReads:0`, retained the exact duplicate-model input text, and located the second `User` name at LSP range `(4,6)–(4,10)` (human line 5, columns 7–11). The clean on-disk schema remained literally `model User {\n  id Int @id\n}\n`; the post-run read is an observation after the editor call, not how the diagnostic was produced.

### AttributeCtx extension diagnostic

The supplemental command uses exported `modelAttribute`, `interpretAttribute(attribute, spec, { sources })`, typed `document.declarations()` / `model.attributes()`, and resolves the diagnostic owner from the callback's `ctx.sources.sourceFileFor(node.syntax)`. No independent sourceId is placed on the context. Actual output excerpt:

```json
{
  "code": "QA_ATTRIBUTE",
  "message": "qa diagnostic",
  "sourceId": "/tmp/psl-source-provenance-qa-Di310F/scenario-3/extension-author.prisma",
  "span": {
    "start": { "offset": 29, "line": 4, "column": 3 },
    "end": { "offset": 33, "line": 4, "column": 7 }
  }
}
```

This is the `@@qa` token on source line 4, columns 3–7. The result is `ok:false` with that diagnostic in `_failure`. The first supplemental attempt incorrectly used `./src/exports.ts` rather than `./src/exports/index.ts`; that runner error and retry are both preserved, and are not counted as product findings. The literal script has further invalid surfaces beyond the first exception: `modelAttribute` is not exported from its chosen types module, interpretAttribute arguments are reversed, and AttributeCtx uses `sources`, not `sourceId`/`sourceFile`.

### Unreadable source path

Supplemental invocation replaced only top-level await with `.then(...)`. It returned `ok:false`, with one diagnostic:

```json
{
  "code": "PSL_SCHEMA_READ_FAILED",
  "message": "Error: ENOENT: no such file or directory, open '/tmp/psl-source-provenance-qa-Di310F/scenario-4/missing/schema.prisma'",
  "sourceId": "/tmp/psl-source-provenance-qa-Di310F/scenario-4/missing/schema.prisma"
}
```

No post-parse diagnostics are present. This exercises the script's missing-file read error, not an OS permissions/EACCES case.

## Exploratory notes

- CRLF source with an emoji comment and URI-like filename `untitled:live buffer-α.prisma` retained that filename and placed malformed `name` at LSP `(3,2)–(3,6)` (human line 4, columns 3–7).
- `file:///virtual/missing%20schema.prisma` was preserved unchanged; an unterminated model reported `PSL_UNTERMINATED_BLOCK` at its opening brace `(0,15)–(0,16)`.
- A malformed field inside a namespace was located at `(3,4)–(3,8)`, not at the containing model or namespace header. Empty input retained `memory:empty` with no diagnostics.
- Same text parsed as `memory:a.prisma` and `memory:b.prisma` resolved descendant fields to their respective filenames. Passing B's root to A's registry threw `InternalError: No SourceFile registered for PSL syntax root`.
- Replacing a live editor buffer under the same URI produced the new duplicate diagnostic; passing the new root to the old registry also threw that internal error.
- A deliberately detached red root built from the exact same green object reported `sharedGreen:true` and threw the same unregistered-root error. The green access is an intentional parser-substrate negative probe, not a consumer implementation pattern.
- No silent singleton fallback, stale-buffer read, or unexpected ownership acceptance was observed. No automated test suite was used as a substitute for these live package calls.

Unused optional ideas: permission-denied (rather than ENOENT) source loading and a real editor transport session. These exceed this script's concrete steps; neither is claimed covered here.

## Coverage outcome

| AC ID | Script scenarios | Outcome | Notes |
| --- | --- | --- | --- |
| AC-1 | 1, 3, 4 | Script execution fails; supplemental product oracles pass | F-1/F-2/F-3 prevent literal sign-off; F-4 cleanup omission |
| AC-2 | N/A | N/A for manual QA | Deliberately excluded; no claim about automated editor/coordinate gates |
| AC-3 | 1, 2 | Scenario 2 passes; scenario 1 requires supplemental setup | Live exploration also rejects unrelated and detached roots; F-1/F-4 remain |

## Disposition map

| Finding | Severity | Proposed disposition | Required next step |
| --- | --- | --- | --- |
| F-1 | Follow-up | fix-in-PR | Make copied demo dependencies resolvable from external scratch and rerun literal scenario 1 |
| F-2 | Follow-up | fix-in-PR | Rewrite the script's obsolete attribute probe using current exported APIs and rerun literally |
| F-3 | Follow-up | fix-in-PR | Make provider invocation compatible with documented tsx execution and rerun literally |
| F-4 | Follow-up | fix-in-PR | Add explicit Restore/final cleanup, correct scenario-1 oracle filename, and verify cleanup |

All dispositions are proposals to the owning executor/orchestrator. No baseline waiver, deferred ticket, or accepted-as-is disposition is proposed. Supplemental success does not mark a script finding resolved.

## Cleanup and ending git state

Artifacts were copied before removal. The runner executed `shutil.rmtree(Path("/tmp/psl-source-provenance-qa-Di310F"))`; it does not follow the scratch dependency symlink into the repository. No worktree or external resource was created. Cleanup output:

```text
before-cleanup-scenarios: [('/tmp/psl-source-provenance-qa-Di310F/scenario-1', True), ('/tmp/psl-source-provenance-qa-Di310F/scenario-2', True), ('/tmp/psl-source-provenance-qa-Di310F/scenario-3', True), ('/tmp/psl-source-provenance-qa-Di310F/scenario-4', True), ('/tmp/psl-source-provenance-qa-Di310F/scenario-5', True)]
script-unchanged: True
scratch-root-exists: False
finished-probes: 2026-09-17T10:54:05.622026+00:00
```

A second `test ! -e /tmp/psl-source-provenance-qa-Di310F` at 10:55:02Z printed `scratch cleanup verified`. Starting git status was empty. Ending `git rev-parse HEAD` remained `793f8ade15d5430bb0d09094441da5f0fcef01bb`; ending `git diff --name-only` / status showed the concurrent implementation executor's changes below and this runner's untracked report directory:

```text
 M packages/1-framework/3-tooling/migration/src/aggregate/loader.ts
 M packages/1-framework/3-tooling/migration/src/aggregate/strategies/plan-from-diff.ts
 M packages/1-framework/3-tooling/migration/src/aggregate/unclaimed-elements.ts
 M packages/1-framework/3-tooling/migration/src/assert-descriptor-self-consistency.ts
 M packages/1-framework/3-tooling/migration/src/contract-space-from-json.ts
 M packages/1-framework/3-tooling/migration/src/graph-ops.ts
 M packages/1-framework/3-tooling/migration/src/invariants.ts
 M packages/1-framework/3-tooling/migration/src/io.ts
 M packages/1-framework/3-tooling/migration/src/read-contract-space-head-ref.ts
 M packages/1-framework/3-tooling/migration/src/refs.ts
 M packages/1-framework/3-tooling/migration/src/runtime-detection.ts
 M packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts
?? docs/testing/manual-qa-reports/
```

The checkout is intentionally not claimed clean: concurrent implementation was authorized. This runner changed only the report and evidence files listed above. The source snapshots use `.prisma.txt` so they remain evidence rather than active schema inputs. An automatic diagnostic hook initially treated the copied `.prisma` evidence as active schema and reported its unavailable Prisma CLI; no manual npx command was run, and the evidence was renamed to `.txt`.

## Handoff

Fix F-1–F-4 in `docs/testing/psl-source-provenance-manual-qa.md` through the script owner, then independently rerun the corrected literal commands and Restore steps. Do not treat this run as PR-ready approval. The main executor owns git: this report and its evidence are intentionally uncommitted; no push/open was attempted. Final verification at 10:57:33Z retained the same HEAD, printed `?? docs/testing/manual-qa-reports/`, confirmed the script diff empty, and printed `scratch cleanup verified`. `lens_diagnostics mode=all` scoped to this report returned `No files diagnosed yet this session`; this cache-only result is not a workspace validation claim.
