# Dispatch 6: trial of comparisons that decide the large packages

Issued 2026-11-26 to a spike implementer (Opus, medium effort). Slice spec: [../spec.md](../spec.md), section "Generated type tests". Code: `scripts/public-api/compat.mjs`, `compat-structural.ts`, `api-compat.mjs`. Last full run: `wip/compat-work/run-all-4.log`.

The design is strong guidance and our best effort, not a fixed spec. Reason from first principles.

## The problem

Each generated test asks whether `StructuralNew<current X>` is assignable to `StructuralOld<release X>`. The helpers map every member recursively so that methods are compared as function-typed properties and private members, unique-symbol keys and brands are dropped. On the large packages TypeScript gives up: once a TS2589 ("type instantiation is excessively deep") no longer hides later tests, 687 of 2,440 tests in `orm-framework` are too deep on their own, and with a two-minute budget per package 7,758 of 9,108 comparisons over all packages end undecided. The check is honest but decides little for `orm-framework`, `orm-family-sql`, `orm-family-mongo` and the `orm-target-*` packages.

## Question

Is there a way to compare the last release with the current build that decides almost every export of those packages within a CI budget, while still catching what the current helpers catch?

## What it must still catch

Every fixture under `scripts/public-api/fixtures/compat/` must keep its current verdict (run the compat test files, not a suite). The known real breaks must still be found: the join-scope change in `orm-family-sql` (`Db`, `TableProxy`, `Namespace`) and the widened key in `orm-family-mongo` (`BuildFailure`, `BuildRefusal`, `buildMongoContractFromDefinition`). A control run comparing a package's current build with a copy of itself must give no break.

## Ideas to try (add your own)

1. **Native first.** Compare with TypeScript's own assignability (no mapping). A native pass is decided except where it can be wrong: methods compare parameters in both directions, so add explicit checks for methods (each method's parameters, contravariantly, and return type). A native failure caused only by `#private` members or unique symbols across the two copies falls back to the structural helper or is classed separately.
2. **Generate per member, not per type.** Let the generator walk each exported interface, class and type in JavaScript with the checker, and emit one shallow test per member (property type covariantly; method parameters contravariantly and return covariantly; constructor likewise), comparing member types natively. Recursion then happens once per named type in the generator, not inside one type-level mapping.
3. **Bounded structural mapping**: map only the top level or two, compare deeper natively. The earlier trial found depth 5 missed the join-scope break and depth 10 was slow and still too deep; say whether a different cut (for example stop at any named type from our packages) does better.

## Measure, per idea

For `orm-framework`, `orm-family-sql` and `orm-extension-middleware-cache`: tests decided and undecided, breaks, false breaks in the self-copy control, time and peak memory; and the fixture verdicts. Then, for the best idea only, one run over all packages.

## Constraints

- Work in this worktree only. Prototype under `wip/compare-trial/`; do not change tracked files. No system temp folders.
- Do not run `pnpm build` or any test suite. Run only the compat test files and your own scripts.
- This machine runs many sessions: one package at a time, with a hard time limit on every run (`perl -e 'alarm N; exec @ARGV' …`). Kill only PIDs you started.
- No commits, no pushes, no destructive git operations.

## Report

Return, recommendation first: the numbers per idea, which fixtures change verdict and why, what each idea cannot see that the current helpers can, and the full-run numbers for the best one.
