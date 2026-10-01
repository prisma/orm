## 2026-10-01 — Binder project final retro

**Trigger:** Mandatory project-close retro.

**What happened:** Binder, SQL, Mongo, and LSP conversions merged; LSP PR #30545 merged as `8ae10563731eec35cd3758a5c7a2d10574bf86a1` with all 27 checks successful. Exact diagnostic assertions exposed duplicate voices and downstream expectations missed by package-only validation. Review also removed redundant mapping structures and restored the explicitly required `ScopeStack` after an unauthorized substitution.

**Root cause:** Validation sometimes checked for the presence of an expected diagnostic rather than the complete result, or treated passing test counts as compiler evidence. Implementation briefs did not consistently distinguish an explicitly selected mechanism from replaceable implementation details. Rebuilt dependencies, independent typechecks, and downstream checks provided stronger evidence than stale editor reports or narrow test counts.

**Landing surface(s):**

- Project-context: `drive/retro/README.md`, recurring-pattern catalogue — exact diagnostic sets, downstream assertions, dependency builds, independent compiler evidence, and preservation of explicitly required mechanisms.
- Existing ADRs 163, 249, 253, and 255 and parser/LSP package READMEs are the approved homes for binding, snapshot identity, scope, completion, and diagnostic-ownership decisions. Their close-out amendments must be verified before project deletion.

**Close-out dispositions:** The operator explicitly waived further manual QA: “no manual qa pass, otherwise ok.” Existing SQL manual-QA evidence remains historical evidence; no Mongo/LSP manual-QA success is claimed. Previously waived full-workspace failures are not being rerun or reported as passing. Linear tracking was omitted at the operator's request. No new feature scope is deferred by this close-out; Prisma7 conversion and incremental reparsing remain non-goals.

**Remaining gate:** Verify the durable documentation changes before removing project artifacts. The post-merge dependency build passed all 26 tasks and the official language-server typecheck passed; the active editor probe still reported 19 diagnostics not reproduced by the compiler. The trace emitter could not record this retro because its externally installed script cannot resolve `arktype`; the retro and durable lesson are recorded here and in the project-context README.
