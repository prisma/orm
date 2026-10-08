# Slice 3: the host proves the end state

Repositories: prisma/prisma-cli (one PR), prisma/web (one PR). Parent: [`../../spec.md`](../../spec.md). Grounding: [`grounding.md`](./grounding.md), read against prisma-cli `main` at 4d254ff, prisma/web at e262c4d and Composer PR #331 on 2026-10-01.

## At a glance

From a copy of `examples/orm-demo` outside the Composer workspace, with `prisma` built from this branch:

```
$ prisma dev module.ts            # runs against the composer section
$ prisma --version                # 8.0.0-rc.20 (or whatever the release is)
$ prisma deploy module.ts         # with prisma-composer.config.ts restored:
CLI.CONFIG_SECTION_INVALID  The 'composer' section of .../prisma.config.ts is invalid.
  CONFIG.FILE_RETIRED  .../prisma-composer.config.ts is no longer read. ...
```

With `effect@4.0.0-rc.118` forced over the pin:

```
$ prisma dev module.ts
CLI.CONFIG_UNREADABLE  .../prisma.config.ts could not be evaluated: Cannot find module '.../effect/dist/unstable/http/FetchHttpClient.js' ...
$ prisma --version
8.0.0-rc.20
```

## Chosen design

**Pins.** `packages/cli` and `packages/prisma` pin `@prisma/composer-cli` and `@prisma/composer` at 0.26.0; the manifest-pins test keeps them equal. When Composer 0.26.0 reaches `latest`, the repository's update-product-versions workflow opens its own auto-merge pin PR; this slice's PR supersedes it (close the automatic one, or rebase onto it if it merged first). The engine-pin exception for composer-cli in `scripts/conformance.ts` is removed, as its own note says this bump does.

**Host tests.** `tests/fixtures/config/composer-section.config.ts` carries a real `composer` section built from the published `@prisma/composer/config` and the Prisma Cloud control entry, or a minimal valid section if the control entry cannot load in the test; the `dev --config` tests in `bin.test.ts` assert the engine headline `CLI.CONFIG_SECTION_INVALID` with Composer's `CONFIG.FIELD_RETIRED` in `diagnostics[]` for a `configPath` fixture, and collapse the Windows/non-Windows pair, since validation now fails before the handler. `composer-isolation.test.ts` still passes: the family's static graph is unchanged and `@prisma/composer/deploy` still exists for the canary.

**The host's shipped skill.** `skills/prisma-platform-core-concepts/SKILL.md` stops saying `prisma-composer.config.ts` is mandatory and that `dev` fails with `CONFIG.FILE_MISSING`; it describes the `composer` section and the three `CONFIG.` codes in the same terms as Composer's skill. The skill is packed into the `prisma` tarball and installed by `prisma init`, so this is user-facing.

**Release.** The pin bump alone publishes only a dev build. This PR also runs the repository's `pnpm bump-version` so the merge publishes a `prisma@latest` that pins Composer 0.26.0. Merging therefore publishes a host release; the orchestrator asks Will before merging.

**Proof from the host binary.** Manual QA against a copy of `examples/orm-demo` placed outside the Composer workspace, with `@prisma/composer*` installed from the registry at 0.26.0 and `prisma` from this branch's build: `prisma dev --help` and `prisma deploy --help` exit 0 and list no `destroy` or `log`; `prisma dev module.ts` starts (no credentials needed); with the old file restored, `CONFIG.FILE_RETIRED`; with `composer: { configPath }`, `CONFIG.FIELD_RETIRED`; with `effect@4.0.0-rc.118` forced via a package-manager override, `prisma dev` gives `CLI.CONFIG_UNREADABLE` naming the missing `effect` module and exit code 2, while `prisma --version` exits 0. `deploy` checks credentials before config, so the `effect` case is proven through `dev`, and through `deploy` only if a service token is available. The transcript is saved in the slice folder.

**prisma/web.** One PR, commits carrying `Linear: TML-3340`: the five mentions of `prisma-composer.config.ts` (getting-started twice, porting-an-app, prisma-compute deploy, the agent prompt on the index page) become the `composer` section with the `prisma/config` import; the `effect` pre-flight passages in getting-started and deploying describe the fail-fast `CLI.CONFIG_UNREADABLE` behaviour and the pins instead; `cli/configuration.mdx` gains the `composer` section and says that it merges whole across a config chain, unlike key-by-key sections.

**TML-3340.** Closed with a comment saying the scope widened to the config merge and the binary's removal, linking the three PRs, and listing `destroy` and `log` as commands `prisma` lacks, with the programmatic operations as the documented path.

## Coherence rationale

Everything here is the host and the public docs catching up with what Composer 0.26.0 published. One reviewer per repository can hold each PR.

## Scope

**In:** everything above. **Out:** any new host command; changes to the engine; Composer changes (if the proof finds a Composer defect, it is a Composer fix PR, not part of this slice).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| The automatic pin-bump PR exists when this PR opens | Close it with a comment pointing here, or if it merged, rebase onto main and keep only the test and skill changes. |
| `bin.test.ts` runs `main()` in-process, not the built binary | The in-process tests cover the diagnostics; the built binary is exercised by the manual QA and the e2e suite. |
| Composer's examples pin `prisma` at the previous host release | Inside the Composer workspace the override makes them run the workspace family regardless; once this release is out, a follow-up Composer PR bumps the catalog entry. Recorded as a deferred item. |

## Slice-specific done conditions

- The QA transcript shows every case above from the built `prisma` binary against a project outside the Composer workspace.
- `pnpm test` in prisma-cli passes, including the conformance suite without the composer-cli exception.
- The prisma/web PR is open with the `Linear:` trailer and its content checks pass.

## Open questions

None. Whether to merge, and so publish the host release, is Will's call at PR time.
