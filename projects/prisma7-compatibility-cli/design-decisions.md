# Design decisions

## 1. Infer CLI distribution identity from the executed binary

**Trigger:** Mid-flight falsified assumption, operator-authorized after a package-manager probe.

**What was learned:** The original design assumed a private environment marker plus a global symbol was needed to carry `prisma7` identity across the wrapper and Prisma's separately bundled dispatcher/CLI/completion modules. A real-tarball `/tmp` probe showed that supported npm, pnpm, Yarn node-modules/PnP, Bun, package-script/exec, direct Node, and npm-global launches expose either a `prisma7` shim path or a `prisma7.js` target in `process.argv[1]`; normalizing the filename stem yields `prisma7` in every supported binary launch tested.

**Decision:** Give the wrapper a distinctive `prisma7.js` target and derive immutable identity from `path.parse(process.argv[1]).name`. `prisma7` selects the compatibility identity; all other names default to ordinary `prisma`. Remove the environment marker, marker cleanup, global symbol, and dispatcher-side cross-bundle initialization. Custom renamed symlinks and programmatic `require()` callers default to `prisma` and are outside the supported binary-invocation contract. Windows execution remains a validation item because the Linux probe could inspect but not execute Windows shims.

**Affected artifacts:** `projects/prisma7-compatibility-cli/slices/side-by-side-wrapper/spec.md`, `projects/prisma7-compatibility-cli/slices/side-by-side-wrapper/plan.md`, and open PR #29949.
