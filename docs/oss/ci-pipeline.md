# PR CI pipeline

This page documents how the pull-request CI pipeline ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) is structured for cost — how it avoids redoing work within a run, across runs, and on PRs whose changes cannot affect the result — and the constraints that shaped those choices. It captures the *why*; the workflow file is the *what*.

## What runs on a PR

`ci.yml` reports stable verification contexts including `Build`, `Type Check`, `Lint`, `Test`, `E2E Tests`, and `Integration Tests`; a small `Detect inert diff` job classifies the diff (below). Four non-required `Package Tests` shards upload native coverage blobs, `Coverage` merges and gates them while `Test Examples` runs concurrently, and a lightweight final `Test` fan-in preserves the required check name. A separate `DCO` check and the preview-publish workflow also run. `main` is governed by a repository ruleset that requires the verification contexts plus `DCO` and uses the strict "branch must be up to date" policy. Two consequences drive the whole design:

- A required status check that never reports its result **wedges the merge**. So a job that is required can never be skipped at the job level — it must always launch and report.
- The ruleset is a fixed constraint. The pipeline is designed *around* it; CI changes never edit the ruleset or the set of required check names.

## Build once per run, and across runs

Every job needs the workspace built. Rather than have each job rebuild the 92-package graph independently, the pipeline builds once and shares the result through a **single-writer Turbo cache**:

- A `.github/actions/setup` composite action primes two [`actions/cache`](https://github.com/actions/cache) entries — the pnpm content-addressable store and Turbo's local cache (pinned to `.turbo/cache` via `TURBO_CACHE_DIR`).
- The `build` job runs first; every other job declares `needs: build`. The Turbo cache key is the head commit SHA, so on a given run `build`'s key is a miss and it is the **only** job that writes the cache. Every other job restores that exact key and — per `actions/cache`'s documented behaviour on an exact-key hit — skips saving. Their `pnpm build` step becomes a cache hit (`FULL TURBO`) instead of a real rebuild, so the build runs for real exactly once per run.
- A restore-key (`turbo-<os>-`) warms the cache from previous runs, so even the `build` job is incremental across pushes.

The single-writer rule is load-bearing for both correctness and safety: because only `build` ever writes, the persisted cache contains build outputs only — test and coverage results can never leak into it. (An earlier shape that let every job write the same key let a non-building job win the save race and persist a build-less cache, which made downstream jobs rebuild anyway. Making every job `needs: build` is what fixes it.)

Test, e2e, integration, and coverage results are never reused across workflow runs, attempts, or commits. Their pass/fail is not a pure function of Turbo's declared inputs (services, pass-through env), so a stale "pass" could mask a real regression. Package coverage shards upload uniquely named, one-day artifacts scoped to the current workflow attempt. `Coverage` downloads the `package-coverage-*` set into one directory and verifies all four expected blob filenames before merging. GitHub makes prior-attempt artifacts inaccessible, so use **Re-run all jobs**, not **Re-run failed jobs**, when retrying this workflow; a partial rerun safely fails the four-file check.

## Skip the heavy work on inert diffs

A PR that only edits documentation should not boot Postgres and run the full test matrix. The `Detect inert diff` job emits an `inert` boolean. The non-required package-test, example-test, and coverage jobs are skipped at the job level, while expensive steps of the `E2E Tests` / `Integration Tests` / `Fixtures` jobs guard on it:

```yaml
- name: Run Integration tests
  if: needs.changes.outputs.inert != 'true'
  run: pnpm test:integration
```

Because required jobs cannot be skipped at the job level (they would never report), those jobs always launch and report green; only their *steps* are gated. Package shards, examples, and coverage are implementation details rather than required contexts, so they may be skipped entirely. On an inert PR the stable `Test` fan-in launches without setup and succeeds once its prerequisite checks are healthy. `Type Check` and `Build` always run but are near-free via the Turbo cache, and `Lint` always runs in full — it is exactly what validates the docs/rules/skills/README changes an inert diff is made of.

### The inert predicate

The classification lives in one place — the [`.github/actions/detect-inert-diff`](../../.github/actions/detect-inert-diff/action.yml) composite — so `ci.yml` and `preview-publish.yml` share a single allow-list rather than two copies that can drift. It is an **allow-list that fails safe toward running**: a diff is inert only if *every* changed file matches a known-harmless pattern (markdown anywhere, `docs/`, `projects/`, `skills-contrib/`, `.agents/`, `.cursor/`, `.claude/`, `LICENSE`). A single unrecognized path — source, `package.json`, the lockfile, `turbo.json`, anything under `.github/workflows/` — makes the whole diff non-inert and runs everything. Off a pull request (e.g. push to `main`) it always reports non-inert.

`preview-publish.yml`'s "Publish preview" is *not* a required context, so there the whole job is skipped at the job level on inert PRs rather than gating each step.

## Constraints that shaped this

- **Hardened Allowed-Actions policy.** The repository only permits an explicit SHA-pinned allow-list of actions. Package coverage transport uses SHA-pinned `actions/upload-artifact` and `actions/download-artifact`; both repositories must remain on that allow-list. See [supply chain](./supply-chain.md).
- **No third-party cache action or remote-cache token.** Caching is first-party `actions/cache` only, preserving the fork-PR posture in [supply chain](./supply-chain.md) (fork PRs get cold caches by design).
- **Least-privilege token.** `ci.yml` grants `GITHUB_TOKEN` only `contents: read`; the caches use the runner's cache runtime token, not `GITHUB_TOKEN`. Checkout steps set `persist-credentials: false`.

## Adjacent workflows

A second PR workflow ([`.github/workflows/bundle-size.yml`](../../.github/workflows/bundle-size.yml)) reports the gzipped cost of `@internal/postgres` and `@internal/mongo` for a single-table contract against both authoring styles (no-emit vs. emitted `contract.json`). It runs [`andresz1/size-limit-action`](https://github.com/andresz1/size-limit-action) against the bundles produced by [`examples/bundle-size`](../../examples/bundle-size); the action checks out the head and the base ref, runs `pnpm size:build` (workspace Turbo build + esbuild) in each, and posts/updates a PR comment with the head-vs-base delta for the four entries.

The workflow is **not a required check** — bundle size is a signal, not a gate, and a required check holding `pull-requests: write` would widen the trust surface on every run. It reuses the same `Detect inert diff` composite so docs-only PRs skip the build entirely. The job scopes `pull-requests: write` to itself; the workflow-wide baseline stays at `contents: read` to match `ci.yml`.

The action is SHA-pinned and must be added to the repository's allowed-actions list (Settings → Actions → "Allow specified actions and reusable workflows") before the workflow can execute — see [supply chain](./supply-chain.md).

## Deliberately out of scope

- **`turbo run test --affected` package-scoped test selection** — would run only the affected packages, but correctness depends on the package dependency graph being complete, which needs its own audit.
- **A merge queue / relaxing the strict up-to-date policy** — likely the largest remaining source of avoidable CI, but the safe fix is a merge queue, which is its own change.
