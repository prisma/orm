# Prisma 8 RC1 — Plan

Everything from the topic documents as dated, ordered steps. Deliberately says nothing about who does what — ownership lives in [Linear](https://linear.app/prisma-company/project/prisma-8-rc1-7592265f700c), where tickets are created as work starts rather than all up front.

**Context docs:** [README](README.md) · [release definition](release-definition.md) · [scoreboard](scoreboard.md) · [feature surface](feature-surface.md) · [repo migration](repo-migration.md) · [parallel install](parallel-install.md)

## Starts now — no dependencies

- Dry-run the history merge in a fork; then create the `v8` branch in prisma/prisma and get CI green on it.
- Check `@prisma/postgres` / `@prisma/sqlite` / `@prisma/mongo` for name collisions. (Publish permissions on the `prisma` package are already held; the remaining trusted-publisher configuration is release-week work.)
- Build the side-by-side fixture (v7 + v8, one database, v7 owns migrations). Biggest untested claim; needed green by July 24.
- Build the TypeScript compile-time benchmark and its public Bencher dashboard — before the type freeze, while types can still be fixed.
- Enumerate the feature-support matrix rows (v8 surface × Prisma 7 capability census) and draft verdicts; produce the list of "works"-claimed cells with no proving test.
- Deduplicate migration contract snapshots into `migrations/snapshots/` (the folder layout freezes at RC).
- Rename `extensionPacks` → `extensions`, and sweep the config format for other keys we'd regret freezing.
- PSL mixins ([TML-3055](https://linear.app/prisma-company/issue/TML-3055/psl-mixins-named-field-set-reuse-retire-field-presets-type-aliases-and)): spec and slice plan immediately, then execution — mixins replace field presets and type aliases, type constructors replace `@db.*` attributes, and `@dbgenerated()` retires in favor of ADR 129 tagged literals for raw SQL defaults. The largest pre-freeze item; PSL syntax freezes at RC.
- **Critical path** — the `.include()` decode class, tracked as the Codec JSON projections project ([TML-3060](https://linear.app/prisma-company/issue/TML-3060/plan-codec-json-projections), in flight; four-slice stack TML-3062 → TML-3061 → TML-3063 → TML-3064, artifacts in `projects/codec-json-projections/`): codecs' JSON contracts don't match what Postgres renders through `json_agg`, so a plain `DateTime` column read through `.include()` throws today, and `numeric`/`BigInt` values silently lose precision in the envelope parse. The flagship read path failing on default types is the hardest "everything we ship works" breaker on the list; the lossless-projection hard cut (TML-3063) must land — with the every-codec-through-`.include()` sweep the project specifies — before the July 24 matrix-verdict freeze, or the affected matrix cells read broken.
- Date columns work end-to-end once the type-constructor work binds the postgres `Date` type to `pg/date@1`. The codec shipped unbound in [TML-3037](https://linear.app/prisma-company/issue/TML-3037/contract-infer-output-round-trips-through-contract-emit); until the pin lands, a `date` column read through `.include()` fails at runtime — an "everything we ship works" breaker. One line in the contribution table (`{ codecId: 'pg/date@1', nativeType: 'date' }`, via `codecId`, not a second `targetTypes` registration — marker comment sits at `pgDateDescriptor`); `infer-roundtrip-runtime.integration.test.ts` pins the broken behavior and flips red on the fix, telling the implementer the exact assertion to flip. Rides the mixins/type-constructor slice. (The date instance also needs the codec-JSON-projections fix above — the two meet at the same read path.)
- Drop the `sha256:` prefix from all hashes and hash references (emitted contracts, migration manifests, marker/ledger, ~368 source files; regenerate examples). The textual hash form freezes at RC.
- Implement template-tagged literals in PSL per ADR 129 (`` pg.sql`…` `` backtick fences for extension-owned text; currently unimplemented — plain quoted strings would freeze as the API otherwise). Coordinate the grammar work with the mixins project.
- Fix the connection-pool crash (missing error listeners).
- Continue the polymorphism bug-fixing stream (feeds the July 24 call).

## Fri July 18 — decision: error-code format

Choose between the dotted format (`RUNTIME.DECODE_FAILED`, ~89 codes) and the prefixed-numeric format (`PN-CLI-4001`, ~46 codes). Recommendation on the table: dotted wins. The decision unblocks:

- The error consolidation: fold all four error systems into the chosen format, give codes to the ~16 codeless error classes, publish the old→new mapping table. Codes freeze at RC; message wording can keep improving after.

## Tue July 22 — decision: minimum Postgres version

Keep the Postgres 17 floor (it was an early-access-era convenience) or lower it for the migrating audience. Every supported version is a CI matrix row forever. The decision unblocks final matrix verdicts for version-sensitive cells.

**Decided August 11: the floor is 15** ([ADR 248](../../docs/architecture%20docs/adrs/ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md)). CI already runs `postgres:15` in every job, so the lowered floor adds no new matrix rows today; the feature-implied floor is 12, so 15 carries ample headroom.

## Wed July 23 — quality sweep target

Aim to have landed by here (all independent, none block anything):

- The old-name sweep: `init` templates, installed user skills, upgrade skills, documentation links inside error messages, deprecation notice on the old `prisma-next` package, and keep-or-rename decisions on env vars / config paths / telemetry identifiers.
- Documentation-comment audit of the per-database packages' exported surface.
- The `pg` driver deprecation warning; the open Dependabot alerts; the npm README for `prisma`.
- Port the highest-value Prisma 7 test cases against the matrix's unproven-cells list (continues afterward; this is a stream, not a single step).

## Thu July 24 — the go/no-go checkpoint

Three calls, made in writing:

1. **Polymorphism: stable or experimental.** Rule: new bugs stopped appearing → stable; still appearing → experimental, work continues post-RC.
2. **Matrix verdicts freeze.** Every cell now reads works-with-proof, experimental, or not-in-8.0.
3. **Side-by-side fixture green?** If not, scale the announcement's migration claim back to what's proven.

After this day, no scope moves — only execution.

## Fri July 25 — announcement-day readiness

- Announcement and upgrade guide drafted (guide's code samples lifted from the fixture).
- VS Code: confirm the v7 extension and the v8 language server coexist in a dual-install project.
- Docs landing page for v8 exists; issue templates route v7-vs-v8 reports; first-response plan for launch week.
- Verify or soften the Windows / Bun / Deno claims; review the telemetry consent prompt and backend capacity.

## Mon July 28 – Thu July 31 — release week

In order:

1. Version everything to `8.0.0-rc.1` (lockstep, one command).
2. Rename the CLI package to `prisma` and the three per-database packages to `@prisma/*`; configure trusted publishing for the new names.
3. Cut the `v7` maintenance branch with working CI.
4. Merge `v8` into `main`.
5. Close old v7 issues/PRs except v7 bugs; pin the explanation issue.
6. Re-run the runtime benchmarks; confirm the published numbers still hold.
7. Render and publish the feature matrix (the public scoreboard).
8. Publish under the non-`latest` dist-tag; verify `npm install prisma` still yields v7 and the RC tag yields v8 with the `prisma-next` binary working (and no `prisma` binary declared).
9. Deprecation notice on the old `prisma-next` package.
10. **Announce.**

## After the RC (road to 8.0.0 final)

- Nightly runtime benchmarks in CI (about a day to make reliable — spent now that it doesn't compete with the release).
- The public matrix page drives the road-to-final story: crosses flip to ticks; gaps get tracked issues on an `8.0.0` milestone.
- Implement `migration plan --advance` (the cutover convenience command).
- Package consolidation (stop publishing the ~60 internal packages).
- Biweekly public status updates until final. Final ships on criteria, not a date: every cell proven or excluded, the migration fixture green, a quiet period with no new blockers.

## Close-out (required)

- [ ] Verify all acceptance criteria in [spec.md](spec.md)
- [ ] Migrate long-lived docs into `docs/` (upgrade guide, coexistence workflow, error-code scheme + crosswalk, snapshot layout, the matrix's permanent home)
- [ ] Strip repo-wide references to `projects/prisma-8-rc1/**`
- [ ] Final retro; delete `projects/prisma-8-rc1/`
