# What the release is

## The release

On July 31 2026 we publish **`prisma@8.0.0-rc.1`** — Prisma Next, versioned as Prisma 8, released from the merged `prisma/prisma` repository — and announce it publicly the same day.

It is a release candidate, not a final release. That distinction does the most important work in this whole plan: **a release candidate freezes the API surface; it does not promise completeness.** Our bar is not "Prisma 8 can do everything Prisma 7 can do." Our bar is: everything we ship works, we can prove it, and everything we don't ship is named explicitly rather than discovered in production.

The version number is 8 (we considered 10 to signal a bigger jump, and rejected it — the architecture and the marketing already tell the discontinuity story, and a skipped version number is permanent confusion for no gain).

## What freezes on July 31

Once the RC is out, users write code, scripts, and runbooks against it. These surfaces therefore cannot change between RC and 8.0.0 final, which means all changes to them must land before July 31:

- **Package names.** The `prisma` package and the per-database packages users import.
- **The CLI.** Command names, flags, and the names of the installed binaries.
- **Error codes.** Users write `catch` logic and alerting rules against them.
- **Configuration keys.** For example the `extensionPacks` key, which is being renamed to `extensions` — that rename must happen now or never.
- **The `migrations/` folder layout.** Users commit this folder to their repositories and tools read it. The planned deduplication of contract snapshots inside it must land before the RC.
- **Emitted artifact formats.** `contract.json` and `contract.d.ts`.
- **Version floors.** Minimum supported Node.js, TypeScript, and database versions.
- **Names that look internal but aren't.** Environment variable names, the per-user config file path, telemetry identifiers. Each needs an explicit keep-or-rename decision before the freeze, because after it they're permanent.

Anything not on this list — message wording, documentation, additional tests, performance improvements, internal package structure — can keep changing after the RC.

## What we promise at the RC

1. **Nobody gets v8 by accident.** The RC publishes under a dist-tag other than `latest`, so `npm install prisma` continues to install Prisma 7 until 8.0.0 final ships.
2. **API stability from RC 1**, with the experimental parts named explicitly. The experimental list is what protects the stability promise. The database tiers are part of this statement: **PostgreSQL is the general-availability target — and the only one. MongoDB ships in early access; SQLite is a proof of concept.**
3. **Prisma 7 is maintained for 18 months, counted from the day 8.0.0 final ships** (not from the RC — if final slips, the promise must not silently shrink). Bug fixes and security updates on a `v7` branch; this window is stated in the announcement.
4. **v7 and v8 run side by side in one project**, so migration can be incremental. This claim gets its own document: [parallel-install.md](parallel-install.md).
5. **A public scoreboard instead of promises.** The feature-support matrix (see [scoreboard.md](scoreboard.md)) shows exactly what works where, what's experimental, and what's not in 8.0.
6. **Promotion criteria instead of a date for 8.0.0 final.** Final ships when every matrix cell is either proven or explicitly excluded, the migration recipe passes its test, and a quiet period passes with no new release blockers. We give a target window, never per-feature dates.

## What we deliberately do not promise

- Prisma 7 feature parity.
- A stability guarantee for features marked experimental.
- Runtime performance numbers beyond what's already published (the comparison benchmarks are public; before tagging the RC we re-run them to confirm they still hold).
- A renamed GitHub organization or repository (`prisma/prisma-orm` was considered and parked — GitHub redirects make it cheap to do at any later point).
