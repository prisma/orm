# Manual QA report — SQL namespace resolution — setup attempt 2

Script: [manual-qa.md](../manual-qa.md), corrected color flag, uncommitted. Runner: slice-close agent. Linux / Node v24.19.0 / HEAD `2c815e3163f3fc7983df35da7f9867fe87d11ca3`. Started 2026-09-28T10:58:54Z; finished 10:59Z. Verdict: triage required (script setup incomplete).

All five invocations of `PRISMA_TELEMETRY_DISABLED=1 node "$REPO/packages/1-framework/3-tooling/cli/dist/bin.mjs" contract emit --config ./prisma.config.ts --format human --no-color` exited 2:

```text
[CONTRACT.SOURCE_LOAD_FAILED] Failed to resolve contract source
why: No schema file carries the "// use prisma-8" directive
[CONTRACT.SOURCE_DIAGNOSTIC] ./contract.prisma PSL_NO_OPTED_IN_SCHEMA_FILES: None of the matched files carry the "// use prisma-8" directive
```

Finding F-2 — follow-up, QA script: public provider requires an opt-in header absent from the script. Proposed disposition: fix-in-PR (script pre-flight) and rerun separately. No product defect; the guard is readable and actionable. The prior attempt's F-1 color flag is resolved in the uncommitted script. SC-2/SC-3/SC-4 NOT VERIFIED, SC-1 N/A; all scenarios stopped at source loading. Scratch retained for correction. `git status --short` still shows only the pre-existing trace modification and untracked slice directory. No production mutation.
