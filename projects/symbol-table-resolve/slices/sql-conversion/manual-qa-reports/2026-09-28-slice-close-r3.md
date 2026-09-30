# Manual QA report — SQL namespace resolution — final run

**Script:** [manual-qa.md](../manual-qa.md), uncommitted corrected revision. **Runner:** delegated slice-close agent. **Environment:** Linux, Node v24.19.0, branch `sql-conversion`, HEAD `2c815e3163f3fc7983df35da7f9867fe87d11ca3`. **Started/finished:** 2026-09-28T11:00:17Z / 2026-09-28T11:01:08Z. **Verdict:** PASS for the bounded manual scenarios; this does not clear outstanding automated-gate limitations.

## Summary

The real CLI emitted namespace-local FKs and both backrelation directions for duplicate model names. A missing type produced one actionable source diagnostic, and the exploratory bare-type versus constructor-call contrast retained the appropriate binder or extension-composition voice. No product findings or blockers were observed. The earlier two setup attempts are retained separately rather than presented as product regressions.

## Execution and observations

Each scenario ran independently in `/tmp/sql-conversion-qa.RpAPnx/<scenario>`, reading rebuilt workspace packages via scratch symlinks. Exact command in every directory:

```bash
PRISMA_TELEMETRY_DISABLED=1 node "$REPO/packages/1-framework/3-tooling/cli/dist/bin.mjs" contract emit --config ./prisma.config.ts --format human --no-color
```

All schemas include the required `// use prisma-8` first line. Configuration and full duplicate-namespace schema are in the script. Exploratory inputs replace the `payload Missing` field with `embedding pgvector.Vector` and `embedding pgvector.Vector(1536)` respectively. Qualification uses the scenario-1 schema with `user public.User` / `user auth.User` in the respective namespaces.

| Scenario | Isolation | Result | Observation |
| --- | --- | --- | --- |
| 1 — duplicate names | tmpdir | PASS, exit 0 | Emitted both artifacts; no ambiguity; both namespace mappings correct |
| 2 — missing type | tmpdir | PASS, exit 2 | One source diagnostic; no output contract |
| 3 — exploratory contrast and qualification | tmpdir | PASS, exits 2 / 2 / 0 | Bare type refused by binder, call by SQL composition advice, explicit qualification matches unqualified output |

The five parallel CLI invocations completed within the 90-second shell budget; inspection completed in 51 seconds, within the exploratory three-minute budget. Per-process timings were not separately captured.

### Namespace output inspected

```text
✔ Emitted contract.json and contract.d.ts
storageHash:  f3e8a8482b724c2a7774b00d654afc1fdcd951aadf51b93a5e14d924734fe786
profileHash:  3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2
```

Actual selected emitted JSON for the public namespace:

```json
{"namespace":"public","fk":[{"source":{"columns":["userId"],"namespaceId":"public","tableName":"public_memberships"},"target":{"columns":["id"],"namespaceId":"public","tableName":"public_users"}}],"user":{"memberships":{"cardinality":"1:N","on":{"localFields":["id"],"targetFields":["userId"]},"to":{"model":"Membership","namespace":"public"}}},"membership":{"user":{"cardinality":"N:1","nullable":false,"on":{"localFields":["userId"],"targetFields":["id"]},"to":{"model":"User","namespace":"public"}}}}
```

Auth had the identical relation shape with `namespace: "auth"`, FK source `auth_memberships`, and target `auth_users`. Explicit qualification produced the same selected JSON in both namespaces. The generated file is readable and its namespace grouping makes the intended target unambiguous. Emission also warned that `contract.d.ts` imports `@internal/target-postgres`, which is not directly linked in this minimal scratch package. This is the documented contributor-alias/manifest setup limitation, not a new resolution defect; compilation of generated declarations was not a manual scenario.

### Diagnostic output inspected

```text
[CONTRACT.SOURCE_DIAGNOSTIC] /tmp/sql-conversion-qa.RpAPnx/scenario-2/contract.prisma:4:11 PSL_UNRESOLVED_REFERENCE: Cannot find type "Missing"
[CONTRACT.SOURCE_DIAGNOSTIC] /tmp/sql-conversion-qa.RpAPnx/scenario-3-bare/contract.prisma:4:13 PSL_UNRESOLVED_REFERENCE: Cannot find type "pgvector.Vector"
[CONTRACT.SOURCE_DIAGNOSTIC] /tmp/sql-conversion-qa.RpAPnx/scenario-3-call/contract.prisma:4:13 PSL_EXTENSION_NAMESPACE_NOT_COMPOSED: Type constructor "pgvector.Vector" uses unrecognized namespace "pgvector". Add extension pack "pgvector" to extensions in prisma.config.ts.
```

Each failure also has the normal command-level `[CONTRACT.SOURCE_LOAD_FAILED]` summary. That is not a second PSL diagnostic: there is exactly one source diagnostic in each case. File/line/column and the offending type are clear, and the constructor case gives concrete config advice. `contract.json` does not exist in any of the three failing cases.

## Findings and disposition

No new product findings. Prior script finding F-1 (color flag) and F-2 (missing opt-in header) are **resolved in the uncommitted script revision** and verified by this run; no artifact commit has been made. This is a script-remediation result, not a claim of a production fix. The known extension-block resolver remains deferred and was not exercised; Mongo and LSP conversion are outside this slice.

## Coverage outcome

| Criterion | Scenario | Result |
| --- | --- | --- |
| SC-1 | Source audit, not manual | N/A |
| SC-2 | 1 | PASS |
| SC-3 | 1 | PASS |
| SC-4 | 2, 3 | PASS |

App-author flow: covered. Extension-author diagnostic: covered by the uncomposed call. New descriptor authoring and parser/shared-generic compile-time compatibility: N/A for manual QA, covered by automated package gates. No database execution claimed. Same-agent author/run limitation follows the operator's no-additional-subagent instruction.

## Cleanup

Scratch directories from all three attempts were removed after preserving observations here; raw command logs remain under `/tmp/sql-close-qa-*.log`. Final status is recorded in the close checklist: only the pre-existing trace modification and untracked slice directory remain. No demos, examples, CI, or production files were changed by QA.
