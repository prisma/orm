# SQL conversion — close preparation checkpoint

Prepared 2026-09-28. No push, PR creation, history rewrite, or artifact commit. Implementation review remains 4/4 PASS, no findings; accepted workspace-test limitations remain in [orchestrator gate disposition](../../reviews/code-review.md#orchestrator-gate-disposition--sql-conversion-d5).

## Synchronization and merge evidence

- Fetched `origin/main` at `e1f125185ed026128d679fe53f1ec384362cfb9e`; before sync there were 16 branch-only and 18 upstream-only commits.
- Initial merge stopped on `interpreter.ts` and `psl-column-resolution.ts`. Resumed only after the orchestrator explicitly authorized the concrete resolutions.
- Signed-off merge commit and current HEAD: `2c815e3163f3fc7983df35da7f9867fe87d11ca3`, parents `a029a88dd0` and `e1f125185e`. `git merge-base --is-ancestor origin/main HEAD` exits 0.
- Retained upstream block/enum diagnostic imports, live unbound constants, and shared framework/parser authoring helpers. Deleted the duplicate local helpers; retained only the branch replacement predicate. Branch relation-target binder/symbol mapping and unresolved skip remain.
- Mergiraf's field/relation resolutions were inspected against pre-merge HEAD: shared helper import relocation and upstream unique-index documentation were the only additions in those files. Defaulted key generics, nested identity maps, and symbol-keyed comparisons remain intact. Upstream nonpartial plain-column unique indexes participate in `modelUniqueColumnSets`, keyed by `ModelSymbol`.
- Only the two explicitly resolved files were added to the already populated merge index. `git diff --cached --name-only -- projects/symbol-table-resolve` was empty before commit. Original trace and untracked artifacts remained unstaged.
- `git diff --exit-code origin/main HEAD -- packages/2-sql/2-authoring/contract-prisma7 examples .github pnpm-lock.yaml` exits 0. Upstream changes to these trees arrived through the merge; the branch adds none.
- Full branch diff read: 21 implementation/test files, 861 additions / 374 deletions. No production edits outside straightforward authorized conflict reconciliation (one unused import removed after typecheck identified it). No new regression test was necessary for an additional semantic change; none was introduced during this close pass.

## Slice-specific done conditions — verbatim walk

- PASS — “Grep-verifiable: the flattened `modelNames`/`compositeTypeNames` sets, `modelNamespaceIds`, and `findModelAttributeNode`/`findFieldAttributeNode` no longer exist in the package.” The unrelated local `modelNames` test variable is not a resolution set. Coordinate keys remain for explicitly retained non-resolution indexes.
- PASS — “Back-relation pairing is symbol-keyed: the D1-discovered defect (two namespaces' same-named models yield false `PSL_AMBIGUOUS_BACKRELATION` on a legal schema) is fixed and pinned red-first with D1's repro.” Existing regression tests pass post-sync; the real CLI emits the four-model schema correctly.
- PASS — “The duplicate-name-across-namespaces regression test exists and passes (red against the old fallback — verify by reverting the fix locally once).” Red-first proof is in the independent review/commit history; no production rollback was repeated during bounded close preparation.
- PASS — “No new diagnostics vocabulary: corrections surface through existing binder codes.” Exact-set tests and CLI output verify the existing code boundary.

## Actual post-sync gates

Node `v24.19.0` satisfies `>=24`; no version switching. All command paths below are from repository root.

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS, lockfile unchanged against main | `/tmp/sql-close-install.log` |
| `pnpm build --filter=@internal/sql-contract-psl... --filter=@internal/sql-contract-prisma7... --filter=@internal/cli...` | PASS, 33/33 tasks; producing dependencies refreshed before downstream checks | `/tmp/sql-close-build.log` |
| `pnpm --filter @internal/sql-contract-psl typecheck` | PASS after removing the unused merged import; repeated after merge commit | `/tmp/sql-close-typecheck.log`, tool transcript |
| `pnpm --filter @internal/psl-parser typecheck` | PASS, repeated after merge commit | tool transcript |
| `pnpm --filter @internal/sql-contract-prisma7 typecheck` | PASS, src + test projects; repeated after merge commit | tool transcript |
| `pnpm --filter @internal/sql-contract-psl lint` | PASS, 78 files; repeated after merge commit | `/tmp/sql-close-lint.log`, tool transcript |
| `pnpm --filter @internal/psl-parser lint` | PASS, 120 files; 3 informational vocabulary notices, no warnings/errors | tool transcript |
| `pnpm --filter @internal/sql-contract-psl test` | PASS, 45 files / 543 tests | `/tmp/sql-close-sql-tests.log` |
| `pnpm --filter @internal/psl-parser test` | PASS, 47 files / 1059 tests, no type errors | `/tmp/sql-close-parser-tests.log` |
| `pnpm --filter @internal/sql-contract-prisma7 test` | PASS, 8 files / 129 tests | `/tmp/sql-close-prisma7-tests.log` |
| `pnpm build` | PASS, 87/87 tasks, 28 cached, 1m29s | `/tmp/sql-close-full-build.log` |
| `pnpm fixtures:check` | PASS, exit 0; independent 1200s budget, completed in 485s; zero tracked drift | `/tmp/sql-close-fixtures-final.log`, `/tmp/sql-close-fixtures-final.status` |
| `pnpm lint:deps` | PASS | `/tmp/sql-close-deps.log` |
| `pnpm lint:casts` | PASS | `/tmp/sql-close-casts.log` |
| `pnpm lint:throws` | PASS, exit 0; independent 600s budget, completed in 81s; current=40, merge-base=40, delta=0 | `/tmp/sql-close-throws-final.log`, `/tmp/sql-close-throws-final.status` |
| `pnpm --filter integration-tests test test/psl-print/constraints-roundtrip.integration.test.ts` | PASS, 10 cases across 2 runtime/typecheck projects; upstream unique-index and relation roundtrip coverage; automatic pretest dependency build passed | `/tmp/sql-close-upstream-test.log` |
| `git diff --check` | PASS | tool transcript |

SQL's `tsconfig.json` includes both `src/**/*.ts` and `test/**/*.ts`; parser test run also reports no type errors; Prisma7 explicitly checks both projects. No full-workspace typecheck or workspace test suite was repeated; prior workspace evidence belongs to the pre-sync HEAD, not this merged one. The changed-base coverage here is the rebuilt producing packages, three complete affected package suites, and focused upstream constraint roundtrip.

LSP initially emitted stale missing-module cascades after frozen installation. Subsequent active probes emitted zero diagnostics but were silent-on-clean/inconclusive. After explicit TypeScript `reloadProjects`, `semanticDiagnosticsSync` returned successful `body: []` for **both** conflicted files; repeated package `tsc` confirms this independently. The replayed 128-error automated reminder is stale, not an unaddressed compiler result. The module-resolution root finding was marked false-positive; no type-inference workaround or lint suppression was added.

## QA and reader artifacts

- PASS — [manual script](manual-qa.md) names app-author and extension-author audiences, with justified N/A for new descriptor SPI work.
- PASS — [final QA run](manual-qa-reports/2026-09-28-slice-close-r3.md): namespace-local FKs/backrelations, single readable typo diagnostic, bare/call diagnostic contrast, explicit qualification. No product finding or blocker.
- Earlier reports record two script-setup mistakes (color flag and missing opt-in directive); both are corrected and verified in the final run. They are not silently discarded.
- [Walkthrough](walkthrough.md) and [PR body](pr-body.md) prepared; [title](pr-title.txt): **Resolve SQL relations by bound model identity across namespaces**.
- DCO audit: **all branch commits have author-matching Signed-off-by trailers**, including merge (17 commits at audited HEAD); no history edits.
- Added long-lived `projects/` reference audit: **zero** in branch-added lines outside project artifacts.
- Linear prefix/link/status items: N/A by explicit operator request, not accidentally omitted.
- No push/PR; CI and actual PR metadata remain future orchestrator actions. Artifacts are still untracked and need orchestrator review before final commit.

## Final gate completion

Both previously incomplete gates passed independently on 2026-09-28 without relying on the earlier timeout waiver. Before rerunning, the prior fixture log was inspected: it stopped after the integration fixture emission sequence, before completion. A process snapshot confirmed no earlier fixture/emit/throw-lint task remained. No persistent subprocess remained after the successful runs.

- `pnpm fixtures:check`: started **11:08:20Z**, finished **11:16:25Z**, exit **0**, 485 seconds within its own 1200-second budget. Emission, extension contract spaces, migration regeneration, and the final diff check completed. Final git status confirms zero production/fixture drift.
- `pnpm lint:throws`: started **11:08:20Z**, finished **11:09:41Z**, exit **0**, 81 seconds within its own 600-second budget. Output: `lint:throws: current=40 merge-base=40 delta=0`.

Exact completion statuses are in `/tmp/sql-close-{fixtures,throws}-final.status`; full logs are the corresponding `.log` files. Process evidence: `/tmp/sql-close-preflight-processes.log` and `/tmp/sql-close-{fixtures,throws}-final.processes`. No additional fetch, production edit, commit, or full-workspace test run occurred. No new gate disposition is outstanding.

Accepted prior workspace failures (39 baseline failures plus CLI telemetry 5000ms and adapter-postgres migration TS roundtrip 8000ms timeouts) were neither rerun nor investigated.

The deferred extension-block resolver remains a documented scope limitation, not a new QA finding. Mongo/LSP conversion is outside this slice; project-wide DoD is not being claimed.

## Recoverable final state

```text
HEAD 2c815e3163f3fc7983df35da7f9867fe87d11ca3
 M projects/symbol-table-resolve/trace.jsonl
?? projects/symbol-table-resolve/slices/sql-conversion/
```

QA scratch directories were removed; command logs remain under `/tmp/sql-close-*.log`. No merge is pending. Only the signed-off merge was committed. Trace and pre-existing untracked artifacts were preserved.
