# Deferred follow-ups

Found while building; not in any slice. File as Linear issues at close-out.

- `pnpm lint:deps` cannot see imports between packages: `@internal/*` imports resolve to `dist/*.mjs`, which `dependency-cruiser.config.mjs` excludes, so plane boundaries in `architecture.config.json` are not checked across packages. Found in the slice 1 system design review (F01).
- Rename the pack descriptor key `authoring.dataTypes` (PSL value entries: tags, plain entries, number classifier) so it does not share a name with `dataTypes` (the data types). Touches ADR 254 and every pack. Slice 1 system design review F10.
- `pnpm fixtures:emit` fails from a clean start when an extension's contract-space head hash changes: example emits run before `build:contract-space` and `migrations:regen`, and the extension `dist` bundles the head hash. Workaround used in slice 2: run `build:contract-space`, `migrations:regen` and an extension build first. Fix the script order.
- `test/integration/test/value-objects/` fixture config no longer emits (`PSL_NO_OPTED_IN_SCHEMA_FILES`): its schema lacks the `// use prisma-8` directive that #30379 started requiring on 2026-09-24. Older than this project; slice 2 rewrote its committed contract with the upgrade script instead. Add the directive and re-emit.
- Slice 3 (TML-3387): a placeholder matches decimal digits only (design 2.2 rule 1), so a reported `numeric(10,-2)` is not recognised although `pg/numeric` allows a negative scale since TML-3278. The resolver's placeholder pattern must accept an optional leading minus for parameters whose schema allows negatives. Add to the slice 3 plan.
