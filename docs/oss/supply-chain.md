# Supply chain

This page documents the supply-chain hygiene practices that protect Prisma 8's published packages and the consumers who install them. Most of these are enforced in CI or in workflow configuration; this page captures the *why* alongside pointers to the *what*.

## License declarations (CI-enforced)

Every publishable workspace package must declare `"license": "Apache-2.0"` in its `package.json`. This is enforced by [`scripts/validate-package-manifests.mjs`](../../scripts/validate-package-manifests.mjs), which runs as part of `pnpm lint:manifests` in the `lint` CI job. A PR that introduces a new publishable package without a license declaration — or with a non-Apache-2.0 declaration — fails CI before it can be reviewed.

The check exists because npm tooling (and downstream consumers running license-audit tools like `licensee`, `license-checker`, or SBOM generators) treats a missing `license` field as ambiguous. Even though the repository itself is unambiguously Apache-2.0 via [`LICENSE`](../../LICENSE), package-level declarations are how that signal reaches the registry and downstream tooling.

## NOTICE-propagation audit (Apache-2.0 §4(d))

Apache-2.0 §4(d) requires distributors of derivative works to propagate any `NOTICE` file from upstream Apache-2.0 dependencies into their own distribution. To check whether we are subject to that obligation, [`scripts/audit-notice.mjs`](../../scripts/audit-notice.mjs) walks the resolved dependency graph of every publishable package and looks for `NOTICE` files in upstream packages.

As of the most recent audit, no runtime-redistributed dependency carries a `NOTICE` file, so we do not need a root `NOTICE` file in this repository. The audit should be re-run when significant runtime dependencies are added or upgraded; if a `NOTICE` is found in a runtime dep, add or extend a root `NOTICE` file and update the statement above to reflect the new audit result.

## npm provenance attestations

The publish workflow ([`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)) sets `NPM_CONFIG_PROVENANCE: "true"` on `pnpm publish`. This produces an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) for every published tarball — a cryptographically-signed statement linking the tarball back to the GitHub Actions workflow run that produced it.

Provenance gives downstream consumers the ability to verify that a `@internal/*` tarball on the npm registry was actually built from this repository on a given commit by a given workflow, not injected from elsewhere. It defends against registry-side compromises and lookalike-package attacks. Provenance requires public source, which we have, and OIDC trusted publishing, which the workflow uses (no long-lived `NPM_TOKEN`).

## Dependabot release cooldown

Dependabot is configured ([`.github/dependabot.yml`](../../.github/dependabot.yml)) with a **release cooldown** on non-security updates. The principle: don't ingest a brand-new upstream release the moment it is published; let the wider ecosystem run it for a few days first.

The cooldown defends against three concrete failure modes that have all happened recently in the npm ecosystem:

1. **Compromised maintainer account → malicious release** (xz-utils, ua-parser-js, event-stream). These are usually identified and yanked or flagged via GitHub Security Advisories within hours-to-days. A short soak window turns "we automatically ingested malware" into "we noticed the advisory before the bump landed."
2. **Accidentally-broken release** (a maintainer ships `1.2.3` that breaks something on a runtime we use, fixes it in `1.2.4` two days later). With instant updates, Dependabot opens a PR for `1.2.3` and CI fails. With cooldown, Dependabot opens it for `1.2.4` and CI passes.
3. **Churny RC-chain releases** (a project pushing several patch versions in a week as a release stabilises). Cooldown coalesces those into one settled bump.

The cooldown is shaped by the change risk:

- **Majors** get the longest soak. Majors carry the most breakage potential and almost never need same-day uptake.
- **Minors** get a moderate soak.
- **Patches** get the shortest soak — just long enough to dodge "shipped broken, fixed within 24 hours" cases.

Current values live in [`.github/dependabot.yml`](../../.github/dependabot.yml) and may be tuned over time as we learn from specific upstream behaviour. The per-tier shape applies to `npm`, where Dependabot understands SemVer; the `github-actions` ecosystem isn't SemVer-typed by Dependabot, so it uses a single default soak window instead.

**Security updates bypass the cooldown entirely.** Dependabot's CVE-driven security-updates path opens a PR within hours of a published advisory regardless of soak settings. The cooldown trades nothing on CVE response time; it only delays version-update PRs.

## Secret scanning and push protection

GitHub's secret scanning and push protection are enabled at the repository level. Secret scanning detects accidentally-committed credentials in the repository history and surfaces them as security alerts; push protection blocks commits that contain detected secret patterns from being pushed in the first place. Both are zero-config for repositories using GitHub's hosted secret-pattern catalog and add a meaningful second line of defence against credential leaks in PRs from contributors who may not have local pre-commit hooks configured.

## Fork-PR runtime posture

Workflows triggered by `pull_request` from forks run with a read-only `GITHUB_TOKEN` and zero access to repository secrets — this is GitHub's default and we rely on it. We do not use `pull_request_target` anywhere in [`.github/workflows/`](../../.github/workflows/); that trigger is the standard pitfall that defeats fork-PR isolation, and we deliberately avoid it.

This is enforced in CI by [`scripts/lint-workflow-triggers.mjs`](../../scripts/lint-workflow-triggers.mjs), which fails the `Lint` job if any workflow under `.github/workflows/` declares `pull_request_target`. The lint has no per-file escape hatch: if we ever need this trigger for a genuinely safe use case, the change has to update the rule itself, in a code-owners-reviewed PR. We adopted the rule after the May 2026 TanStack compromise — `pull_request_target` running fork-controlled build code was the entry point that ultimately published 84 malicious npm packages. See the [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) and [GitHub Security Lab's Pwn Request guidance](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) for the full pattern.

The publish workflow is additionally gated by `if: github.ref == 'refs/heads/main'` so it cannot run from any PR, fork or otherwise.
