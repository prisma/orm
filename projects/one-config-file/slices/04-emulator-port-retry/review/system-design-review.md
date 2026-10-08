# System design review: prisma/composer#333

Branch `fix/dev-emulators-port-retry` against `main` (three-dot), five commits, head `27562e65`.

## What the PR does

1. The dev-emulators "fresh-allocation port retry" test now starts the compute daemon through a fixture (`src/__tests__/fixtures/port-taken-on-first-start.ts`). On its first start the fixture binds its own allocated port, then imports the real daemon, whose bind fails. `ensureDaemon` then retries on the next port.
2. Tests that count the daemon's "listening on" log lines wait for the count to settle (`awaitListeningLines`), because the daemon can answer `/health` before its `listen` callback logs.
3. `PRISMA_COMPOSER_EMULATORS_DIR` overrides `defaultRegistryRoot()`. A relative value throws `DEV.EMULATORS_DIR_INVALID`.
4. `@prisma/composer-prisma-cloud/local-target` exports `emulatorRegistryRoot()`, a renamed re-export of `defaultRegistryRoot`. The three local-dev integration proofs use it instead of hardcoding `~/.prisma-composer/emulators`.
5. The running-locally guide, the core-concepts skill and ADR-0044's code registry describe the variable.

## Overall assessment

The test fix is correct and well-shaped. An environment variable is the right control for the registry root. The main gap is in what the docs promise. The guide says the variable gives "a checkout … its own emulators", but for Postgres two checkouts of the same app still share one running server and one database. `--fresh` in one checkout can stop the other's Postgres daemon and delete its database. The guide should say so plainly. The design doc should also stop calling the emulators machine-scoped without qualification.

### Environment variable versus a config field or a CLI flag

An environment variable is the right choice:

- The registry root belongs to the machine or the CI job, not to the app. A field in the `composer` section of `prisma.config.ts` would be committed, and every clone would then share one value, which defeats the purpose.
- The root is resolved in several processes: the `dev` CLI, the alchemy child that runs the local providers (`computeClient()`, `postgresClient()`), `prisma-composer log`, and the integration proofs. `run-alchemy.ts` spreads `process.env` into the child, so the variable reaches all of them unchanged. A flag would need threading through each process and would end up as an environment variable for the alchemy child anyway.
- Precedent: `PRISMA_COMPOSER_REPORT_FILE` is the environment form of `--report`. A `--emulators-dir` flag that sets the variable could be added later without changing anything here.

## Findings

### D01 — The guide understates the Postgres sharing; for two checkouts of one app it is destructive (medium)

`docs/guides/running-locally.md` lines 115–126 and `skills/prisma-composer-core-concepts/SKILL.md` item 6 say two registry roots "still share local Postgres data". The real behaviour is stronger. `@prisma/dev` instance names come from the app name and database id (`instanceNameFor`). Two checkouts of the same app produce the same names. `postgres-main.ts` lines 523–537 adopt a live server recorded under that name, so the second root's postgres daemon reuses the first root's running server. A teardown or `--fresh` in the adopting checkout runs `deleteApp` (lines 728–754). For an adopted server, `deleteApp` calls `killServer`, which signals the pid in the record. That pid is the other root's postgres daemon, because the servers run inside it. The call therefore stops the other checkout's whole postgres daemon, and `deleteServer` then removes the database. Two checkouts of one app is exactly the case the guide advertises.

Suggestion: before merge, reword the caveat. Say that for an app that uses Postgres, two roots running the same app share one Postgres server and database, and that `--fresh` in one stops the other's Postgres and deletes its database. Raise a follow-up to include the registry root in the instance name when the variable is set (for example, a short hash of the root). That would give each root its own Postgres server.

### D02 — `local-dev.md` still describes the emulators as machine-scoped without qualification (low)

`docs/design/10-domains/local-dev.md` § process model, item 2, says "Machine-scoped emulators — one per node kind". After this PR there is one per node kind per registry root, machine-wide by default. The line "parallel instances are parallel checkouts" (line 30) is about dev instances per working directory. It stays true and needs no amendment. No ADR is needed because the default behaviour is unchanged.

Suggestion: amend item 2 to "one per node kind per registry root (`~/.prisma-composer/emulators` unless `PRISMA_COMPOSER_EMULATORS_DIR` names another)". Also record the strongest reason for the variable, which the guide does not mention. `ensureDaemon` replaces a daemon whose version differs from its own. Two checkouts on different Composer versions therefore keep replacing each other's daemons on the shared root. A separate root stops that.

### D03 — The variable's name fits, but its constant does not follow the repo's naming (low)

The name follows the existing `PRISMA_COMPOSER_*` family (`REPORT_FILE`, `DEPLOYMENT_RESULT_FILE`) and matches the default directory `~/.prisma-composer/emulators`. The extension's own platform variables use `PRISMA_*` (`PRISMA_SERVICE_TOKEN`, `PRISMA_REGION`). This one names a Composer directory, so `PRISMA_COMPOSER_` is the better choice. The constant is the inconsistent part. Other user-facing variables are exported constants with an `_ENV` suffix (`RUN_REPORT_FILE_ENV` in `run-report.ts`, `DEPLOYMENT_RESULT_FILE_ENV` in `deployment-summary.ts`). This one is a private `EMULATORS_DIR_VARIABLE` in `daemon.ts` line 117, and the tests repeat the string literal three times.

Suggestion: export `EMULATORS_DIR_ENV` from `@internal/dev-emulators` and use it in both test files. No central environment-variable reference exists, so the guide is the right place for the documentation.

### D04 — `emulatorRegistryRoot()` on the local-target entry: placement is right, but its surroundings were not updated (low)

The local-target subpath is the right home. It is the control-plane entry that already owns the dev emulators. The target package already depends on `@internal/dev-emulators`, and `lint:deps` passes. The export reveals a path, not a lowering type, so nothing leaks. The exports-entrypoints rule holds, because the shim only re-exports. Three things were missed:

- The shim's doc comment (`packages/1-prisma-cloud/1-extensions/target/src/exports/local-target.ts` lines 1–8) still says the entry is "loaded only via the lazy `localTarget` reference" and that its implementation is in `descriptor.ts`. Neither is true any more.
- The rename (`defaultRegistryRoot as emulatorRegistryRoot`) gives the public function a different name from its implementation, which makes searching harder. Prefer one name in both places.
- `src/local-target-entry.d.ts` declares this subpath's surface for `tsc` and still lists only `localTargetDescriptor`. That is harmless today, but the two have drifted apart.

This is also a public, semver-bound function whose only callers today are the in-repo proofs. The guide offers it to users, which is a reasonable choice because it lets them find `compute.log`. Keep it, but treat it as public API.

### D05 — The first structured error raised inside a cloud lowering package (informational)

`daemon.ts` now imports `CliStructuredError` from `@internal/foundation/errors`. ADR-0044 allows codes raised below the CLI ("codes are vocabulary, not import edges"), and `toStructured` passes the error through unchanged, so `dev` reports `DEV.EMULATORS_DIR_INVALID` with its why and fix. The `FRAMEWORK` map in `packages/9-public/composer-prisma-cloud/tsdown.config.ts` has no entry for `@internal/foundation/errors`, and `@prisma/composer` has no `./errors` subpath. The published package therefore bundles its own copy of the class. This works only because `CliStructuredError.is` checks the shape (`name`, `code`, `toEnvelope`) rather than using `instanceof`. Today no code uses `instanceof CliStructuredError`. If someone adds such a check, the error from the bundled copy will fail it without any warning.

Suggestion: no change now. A one-line comment in that tsdown map is worth adding when the next cloud package raises a structured error.

### D06 — Test shape and naming (no action)

Forcing the failure with a fixture is the right approach. It makes the daemon's own bind fail at the real call site, rather than racing a separate squatter process. `port-taken-on-first-start` says what happens. `awaitListeningLines` is acceptable; `settledListeningLines` would also say that it waits for the count to settle. `EMULATORS_DIR_INVALID` matches the naming of the codes next to it in the `DEV` registry.

## Verdict

Ready to merge after the D01 doc wording is fixed. D02–D04 are small and can land in this PR or as a follow-up. The Postgres instance-name follow-up in D01 should be its own ticket.
