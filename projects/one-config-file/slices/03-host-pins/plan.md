# Slice 3 plan

Spec: [`spec.md`](./spec.md). Branch in prisma/prisma-cli: `one-config-file/composer-0-26`, from `main`. Branch in prisma/web: `one-config-file/composer-section-docs`, from its default branch. Fresh implementer for prisma-cli; the same one does prisma/web.

## Dispatch 1 — The host builds and tests against Composer 0.26.0

**Outcome.** Pins bumped in both manifests and the lockfile; the conformance exception removed; the config fixture and the `bin.test.ts` `dev --config` tests rewritten for the real section and the `CONFIG.FIELD_RETIRED` diagnostic; the host's shipped skill updated; `pnpm test` green; `pnpm bump-version` run last as its own commit. Until 0.26.0 is on the registry, develop against the pkg.pr.new preview of Composer PR #331 and switch the pins to 0.26.0 before the PR opens.

**Builds on.** Composer 0.26.0 published (slices 1 and 2 merged).

**Hands to.** Dispatch 2: a built `prisma` binary that mounts the 0.26.0 family.

## Dispatch 2 — Proof from the binary, and the web pages

**Outcome.** The manual QA transcript from the spec, run against a copy of orm-demo outside the Composer workspace, saved to the slice folder. The prisma/web PR with the five file changes, the pre-flight passages rewritten, and the configuration page's `composer` section, commits carrying `Linear: TML-3340`.

**Builds on.** Dispatch 1.

**Hands to.** Review, PR open in prisma-cli, Will's merge decision, TML-3340 close-out.

## Dispatch 3 — Review fixes

**Outcome.** Every in-scope finding fixed and verified.
