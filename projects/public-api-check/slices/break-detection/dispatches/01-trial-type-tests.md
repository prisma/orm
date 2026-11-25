# Dispatch 1: trial of type tests generated from the last release

Issued 2026-11-25 to a spike implementer (Opus, medium effort). Slice: [../spec.md](../spec.md). Project design: [../../../spec.md](../../../spec.md), section "Breaks: generated type tests against the last release".

## Question

Can we find breaking changes in our published packages by generating, for each export of the last release, a test that asks the TypeScript compiler whether the last release's type still fits the current build's? Microsoft's Fluid Framework does this. The design is our best effort, not a fixed spec: if the trial shows it is wrong or a better way exists, say so with evidence.

## What to find out

1. **The last release.** What versions of our 22 packages (`packages/9-public/@prisma/*`) are on the registry, which is the last release, and how CI would find it (a dist-tag, a git tag such as `v8.0.0-rc.25-dev.9`, or something else).
2. **Fluid's method.** Read how Fluid generates these tests (the `typetests` command of `@fluid-tools/build-cli` in microsoft/FluidFramework, and its `TypeOnly` and `requireAssignableTo` helpers). Note what it does per export kind, which direction(s) it tests, how it handles generics, classes with private members and `unique symbol`, and how a deliberate break is recorded so that the record fails once the break is undone.
3. **A working trial on our packages.** Install the last release beside the current build, under `wip/break-spike/types/` only, so that nothing in the repository's workspace, root `package.json` or lockfile changes. Generate the tests from the export names that our existing reading gives (`scripts/public-api/`), for at least `@prisma/orm-framework`, `@prisma/orm-family-sql` and `@prisma/orm-extension-middleware-cache`, and compile them.
4. **Results.** Per package: exports tested, time to generate and compile, and every failure, each classed as a real change since the last release or a false failure, with its cause.
5. **Planted changes.** In a copy of a current package's declarations under `wip/`, never in `dist` itself: remove an export, narrow a parameter, add an optional parameter, add an optional property, add a required member to an interface that users implement, and to one that users only receive. Report what each direction of the test says for each.
6. **Direction.** The design says the compiler decides whether a new required member breaks. Testing both directions fails a new required member even on a type users only receive. Say how Fluid deals with this and what you recommend for us.
7. **Where it is weak.** Anything that would make this unusable or noisy at our size (1,037 import paths, most forwarded), and the fallback if it is: comparing the `api.txt` lines at the last release's git tag with today's.

## Constraints

- Work only inside this worktree, and put every file you create under `wip/break-spike/types/`. No system temp folders.
- Do not run whole test suites, in any package. Run only files you write. Do not run `pnpm build`: the build in `dist` is current, and another trial is reading it at the same time.
- Every long-running command gets a hard time limit. Kill only processes you started, by PID.
- No destructive git operations, no commits, no pushes. `git status` must be clean at the end apart from gitignored files.
- If a step proves impossible, stop that step, report why, and carry on with the rest.

## Report

Write `wip/break-spike/types/report.md`: the answers to each question, the numbers, the commands you ran, and what you did not verify. Return a short summary with the recommendation first.
