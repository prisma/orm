# Slice 2: the `prisma-composer` binary and its name are gone

Repository: prisma/composer. One PR, stacked on slice 1's branch until it merges. Parent: [`../../spec.md`](../../spec.md). Grounding: [`grounding.md`](./grounding.md), read against slice 1's branch on 2026-09-30.

## At a glance

```jsonc
// examples/orm-demo/package.json
{
  "scripts": {
    "deploy": "bun node_modules/.bin/prisma deploy module.ts",
    "dev": "bun node_modules/.bin/prisma dev module.ts"
  },
  "devDependencies": { "prisma": "8.0.0-rc.19" }
}
```

```ts
// examples/orm-demo/prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
```

`pnpm pack` of `@prisma/composer-cli` yields a tarball with no `bin`. A guide that writes `prisma-composer deploy` fails CI.

## Chosen design

**The examples and CI run the real host.** Every example, `test/integration` and `website` depend on the `prisma` package, the one that ships the `prisma` bin, at the version the host currently publishes, and import `definePrismaConfig` from `prisma/config`. A root `pnpm.overrides` entry points `@prisma/composer-cli` at `workspace:*`, so inside this repository the published host runs the family under test. Scripts keep the `bun` prefix, because services use Bun APIs and the `prisma` bin has a node shebang. Outside the workspace the override does nothing, and the examples run whatever the host pins, which is slice 3's job.

**Teardown in CI is a script over the programmatic operation.** `.github/actions/deploy-verify-destroy`, `scripts/destroy-guard.sh`, `deploy-docs.yml` and the cron canary call the binary today. Deploy and dev go through `prisma`; destroy goes through a repo-private script that calls `destroy` from `@prisma/composer/control` with the config imported from the example's `prisma.config.ts`. The script lives under `scripts/` and is not published.

**Deletions.** In the cli package: `bin.ts`, `cli.ts`, `family/engine-cli.ts`, `family/runtime.ts`, `commands/destroy.ts`, `commands/log.ts`, `target.ts`, the pass-through `orm` section family, their tests, and the `bin` entry in tsdown. `ComposerOperations.destroy` and `.log` and the control double's `destroy`/`log` go with them; the `/control` exports `destroy` and `log` stay, with their own tests. In `@prisma/composer-cli`: the `bin` field, the bin bundle entry, and the `dist/bin.mjs` expectation in `check-cli-engine-pin.mjs`. The `./family` export and `dist/family.mjs` stay, because the host's startup probe matches that path. Stale comments saying `@prisma/composer` ships the CLI, and the `main.ts` citations in `operations/deploy.ts` and `destroy.ts`, are corrected.

**Four integration tests that spawn the binary** get a driver that spawns `node_modules/.bin/prisma` instead; `cli.engine-shell` is deleted. The legacy-file end-to-end test in `host-adapter.test.ts` goes; the rule stays covered in-process.

**`check-npm-effect-resolution.mjs`** stops running `--help` on the binary. Its healthy shapes assert the family module loads and Alchemy imports; the adversarial shape stays as slice 1 left it.

**The name sweep.** Every `prisma-composer <command>` in `README.md`, `docs/guides/`, `skills/`, `skills-contrib/`, `examples/**`, `website/`, `test/`, `packages/**` messages and comments, and `.github/` becomes the `prisma` form, or, for `destroy` and `log`, the programmatic operation. User-facing error text in `dev-emulators/src/client.ts` and `local-target/preflight.ts`, and the generated stack-file headers, say `prisma dev`. The guides and the skill say plainly that the `prisma` CLI has `deploy` and `dev`, that teardown and logs are the `destroy` and `log` operations on `@prisma/composer/control`, with an example of each, and that `prisma` requires login where the standalone tool did not. `getting-started.md`'s `[dev] logs: prisma-composer log` line, which `dev` never prints, goes. `docs/design/` is untouched.

**The CI check.** A script under `scripts/`, wired into the lint job, fails on `prisma-composer` as a command (`prisma-composer <word>`, `bin/prisma-composer`, `bunx prisma-composer`) anywhere in `README.md`, `docs/guides/`, `skills/`, `skills-contrib/`, `examples/`, `website/`, and on the config-file name `prisma-composer.config` in those same trees except an explicit allowlist of the migration passages in `docs/guides/deploying.md` and the skill, each listed by path with the expected count so an added mention still fails. Package and directory names like `prisma-composer-core-concepts`, the `.prisma-composer/` state directory and `prisma-composer.map.json` are excluded by a boundary pattern. The script has a test with a planted mention.

**Release.** `pnpm bump-minor` is run last; it advances 41 manifests, the lockfile and the skill's `library_version` to 0.26.0, so the merge publishes a release.

## Coherence rationale

One fact, the binary is gone, and its consequences: what ran it now runs `prisma` or the operation, what named it now names `prisma`, and a check keeps it that way. The config merge is slice 1 and is not revisited here.

## Scope

**In:** everything under Chosen design.

**Deliberately out:** any new command in the host; the dependency-cruiser exclusion; `docs/design/`; the host's pin bump and the prisma/web fixes (slice 3).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| `deploy-docs.yml` triggers on `docs/guides/**` and runs the binary; this slice edits the guides | The workflow switches to `prisma` and the destroy script in the same PR, so the merge commit's run passes. |
| The published `prisma` pins `@prisma/composer-cli@0.25.0` | The root `pnpm.overrides` points it at the workspace; `check-cli-engine-pin.mjs` must still pass, since the host's engine version and the workspace pin are both 0.6.2. |
| `test/integration` depends on `prisma@7.9.0` | That is Prisma 7 for a Prisma 7 fixture; leave it and add the host under a different mechanism if the two collide, and say how. |
| The skill copy under `packages/9-public/composer/skills/` is staged | Regenerate it the way `check:skill-packaging` expects. |

## Slice-specific done conditions

- From `examples/orm-demo`, `bun node_modules/.bin/prisma deploy --help` and `prisma dev --help` exit 0 and run the workspace family (prove it by a family-side change visible in the output, or by the pin check's externality assertion).
- The packed `@prisma/composer-cli` declares no `bin`; a boundary search for the command form over the repo excluding `docs/design/`, `node_modules`, the dated project records under `.drive/` and the friction report `open-chat-port-friction.md` finds nothing; the new CI check passes on the branch and fails on a planted mention.

Two facts found during implementation, recorded so the spec matches the code: the repository uses the hoisted linker, so the `prisma` bin exists only in the root `node_modules/.bin` and example scripts call it by a repo-relative path, and the override needs a root devDependency on `@prisma/composer-cli` for the hoisted host to find the link. The tarball-resolution script's adversarial shape asserts the family module still imports in the broken tree, since there is no binary to start.
- `.github/workflows/e2e-deploy.yml` passes on the PR with `prisma deploy` and the destroy script.

## Open questions

None.
