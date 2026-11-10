# Database change policies: may db update run, and may a change lose data — design rationale

[`spec.md`](spec.md) states the design. This document explains why it has that shape. It records what Will Madden and the orchestrating agent settled between 2026-10-15 and 2026-10-23.

## The decision

Every database records a **change policy** (whether it may be changed by walking the migration graph, by reconciling it to a contract with `db update`, or both) and a **data protection policy** (whether operations that lose data or widen access are forbidden, need consent, or are permitted). The policies live in the database's marker, and every command that changes a database obeys them. A ref declares the policies its database should have, and a deploy changes a database's policies only with explicit consent. When a deploy finds the database off the migration graph, its error says why and offers the recovery the database's policy permits. A database is never reset to fix a migration problem.

## Why: the incident

On 2026-10-15 an agent deploying `prisma/asks` to its shared development environment with Prisma Composer got `MIGRATION_PATH_NOT_FOUND`. A branch had deployed its migration to development; the migration was then planned again twice before it merged, so the version development had applied was deleted, and development's marker named a hash no committed migration starts from. That sequence is ordinary for any team that deploys unmerged branches to a shared database.

The agent concluded that `db update` was not available, that only a migration could move the database, and that no migration could start from a hash outside the graph. It proposed resetting the database. The right answer was `prisma db update`.

The agent read correctly; the texts were wrong:

- Composer's error scoped `db update` to "Iterating locally?".
- The `prisma-8` skill said to use `db update` "on a solo dev database".
- The migration domain docs call `db update` "dev-only" and say it "tears down and rebuilds the database". It does neither.
- Both recoveries the CLI prints for a database off the graph are refused by the CLI itself, because their starting hash is not a graph node.

Fixing the text fixes this incident. But "use `db update` on development, never on production" can only be expressed today as prose, and an agent short of ideas acts on what the tools allow, not on what the prose recommends. So the database has to carry the rule, and the tools have to enforce it.

## Why two policies, and not one "protected" flag

Change control, the practice ITIL 4 calls change enablement and database tools call database change management, answers several independent questions about a database. This project needs two of them:

- **How may it change?** Walking the reviewed migration graph only, or reconciliation too. This is the **change policy**.
- **May a change lose data or widen access?** This is the **data protection policy**.

They are independent; all four combinations occur:

| | Data protected | Data disposable |
|---|---|---|
| **`migrate` only** | Production | A staging database refilled from fixtures |
| **`migrate` and `reconcile`** | A shared development database, like the incident's | A local or test database |

The incident's database is in the bottom-left cell: its data mattered, which is why a reset was wrong, yet reconciling it was right. A single "protected" flag cannot describe it.

Most prior art's "protected" is data protection: Rails' protected environments, Neon's protected branches and Flyway's disabled `clean` all block destroying data. Only PlanetScale's safe migrations is a change policy.

Three levels of data protection exist because consent is what protects production today. `db update` asks before every loss. A level that forbids every loss also forbids the last step of expand-and-contract, which always drops a column; that suits an archive, not most production databases.

## Why the marker holds the policies, and the ref declares them

A ref is the team's stated intent for a named database. A plan made offline against a ref needs that database's policies, so the ref declares them.

A command connected to a database must know its policies without a checkout. The marker already describes the database on its own terms: it stores the full contract the database satisfies, not only its hash, and the invariants applied to it. Policies are the same kind of fact. Storing only a ref name in the marker, as Rails stores only an environment name, would make the marker unreadable without the repository.

The two copies are desired state and actual state, the same split the migration model uses for contracts and invariants. The ref and the database must agree before a deploy runs, so a ref always describes its database and a plan made against it can be applied.

## Why a policy changes only with consent

A command that both enforces a policy and rewrites it from the ref it is given would override the policy it is meant to enforce: an agent with an edited ref, or a branch deploying to a shared database, would silently loosen it. So `db migrate` and `db update` enforce the database's policy, and change it only with `--permit-policy-change`. A command with no ref changes nothing.

A CD pipeline can only deploy, so the consent is a flag on the deploy, not a separate command. A team that wants reviewed policy changes applied by its pipeline passes the flag; a cautious team leaves it out and applies policy changes by hand. With consent given, the policies are written before the migrations run, so a policy change and the migration it permits ship in one deploy, as they were planned. A policy change needs no migration: when the policies are the only difference, the deploy writes them and nothing else.

## Scenarios

### CI/CD (Composer)

| # | Scenario | Result |
|---|---|---|
| C1 | First deploy of production, whose ref declares policies, with the flag | Migrations run, the policies are recorded |
| C2 | A reviewed pull request tightens production's policy, no schema change | With the flag: policy-only deploy. Without it: the deploy fails until the change is applied by hand. |
| C3 | A reviewed pull request loosens production's policy | As C2 |
| C4 | One pull request loosens `data-loss-forbidden` and adds the lossy migration it permits | With the flag: one deploy, policy first, then the migration. Without it: fails before anything runs. |
| C5 | A deploy with no `targetRef` carries a lossy migration onto a database that forbids data loss | No declaration, no change; refused |
| C6 | No migration path from the database (the incident) | The deploy fails with the error and recovery its policy permits; whoever owns the database acts on it, as with any failed deploy |

### At home (CLI with `--db`)

| # | Scenario | Result |
|---|---|---|
| H1 | A local database with no policies | `db update` works; data loss needs consent |
| H2 | An agent runs `db update` on a migrations-only database | Refused; the next action is authoring a migration |
| H3 | An agent runs `db sign` on a migrations-only database | Refused |
| H4 | An agent runs `db migrate` without a ref, carrying a lossy migration, onto a database that forbids data loss | Refused |
| H5 | An agent edits a ref to loosen it and runs `db migrate --to <ref>` | The ref and the database disagree; refused before anything runs |
| H6 | As H5, with `--permit-policy-change` | Loosened. The flag is the consent, like `--delete`. |
| H7 | The incident's database, recovered by hand | `db update --dry-run`, then `db update`, because the database permits reconciliation |

### Known limits

- Under `data-loss-with-consent`, `db migrate` treats a migration's own contents as consent, given when it was planned. In a pipeline a reviewer saw that consent; from a local checkout nobody did. Only `data-loss-forbidden` stops an unreviewed lossy migration applied by hand.
- The migrations-only recovery for an off-graph database leaves two repair migrations in the graph. A new, empty database could be routed through them if that path is shorter than the main line. The skill tells agents to check with `migration list` and ask a person when it is.
- Anyone with write access to the marker table, or who passes `--permit-policy-change` with an edited ref, can change a policy. The policies stop mistakes, not deliberate workarounds.

## Prior art

| System | Mechanism | Where the rule lives |
|---|---|---|
| Rails | `drop`, `reset` and `purge` refuse on a protected environment; `db:migrate` records the environment in `ar_internal_metadata`; `db:environment:set` sets it by hand | Database stores the environment name; app config lists protected names |
| PlanetScale | A branch with safe migrations refuses direct DDL; changes arrive only through deploy requests | On the database, set through the platform, CLI or Terraform |
| Neon | A protected branch cannot be deleted or reset | On the database; `neon.ts` declares it and `neonctl deploy` applies it |
| Flyway | `clean` is disabled unless `cleanDisabled=false` | Project config, safe by default |
| Liquibase | `drop-all` can require `--force` | Project config |
| Skeema | `push` refuses unsafe operations unless `allow-unsafe` | Config or command line |
| Atlas | Declarative and versioned workflows; lint fails destructive changes | Per-environment config; "versioned for production" is guidance |
| Bytebase | Per-environment rollout policy (who deploys, approval) and SQL review policy | Per environment, in the platform |
| GitHub | Environment protection rules: reviewers, wait timers, deploying branches | Per environment, in the platform |
| Confluent Schema Registry | Compatibility modes decide which side upgrades first | Per subject |
| Prisma 6 | `db push` for prototyping, migrations elsewhere | Documentation only |

## Later scopes of change control

The names leave room for these; none is in this project.

| Scope | Question |
|---|---|
| Permitted change operations | Which operation classes (additive, widening, destructive, data) may run |
| Compatibility policy (working title) | Which running application versions must stay satisfied during a change: expand-and-contract ordering, backward, forward and full compatibility |
| Change authority | Who approves a change, automatically or by hand. Composer and CI own this. |
| Execution constraints | No downtime, lock limits, maintenance windows |
| Recovery | Rollback allowed, or only fixing forward |

The glossary's existing **control policy** (managed, tolerated, external, observed) says whether Prisma may write a given database object. It is unrelated, and the glossary entries say so.

## Follow-ups outside this project

- A one-step command to bring an off-graph database back onto the graph with migrations, including `migration plan --to` accepting a hash from the snapshot store ([TML-3743](https://linear.app/prisma-company/issue/TML-3743)).
- `db update` lists the data transforms it skips and refuses to lose the data they would carry ([TML-3744](https://linear.app/prisma-company/issue/TML-3744)).
- Writing the marker's policies only through a privileged database role.
- Permitted change operations and the compatibility policy.
- `prisma postgres connection delete` rejects `--project`, which `create` and `list` accept.

## Alternatives considered

- **Better error text and skill text only.** Rejected: nothing would stop an agent running `db update` on production, and prose is what failed in the incident.
- **A single "protected" flag.** Rejected: it merges change policy and data protection, and cannot describe the incident's database.
- **Letting `migration plan` start from a hash outside the graph.** Rejected: the migration would serve one database forever, and the rule that a migration starts from a graph node keeps every committed migration applicable.
- **The Rails model: the marker names its ref, the ref holds the rules.** Rejected: the database could not be read without a checkout.
- **A deploy always applies its ref's policies.** Rejected: a deploy would silently override the policy it enforces.
- **A deploy that proceeds when the ref and the database disagree, reporting the difference as pending.** Rejected: the ref would stop describing the database, and plans made against it could be refused at apply.
- **Checking migrations against the old policy and writing the new one afterwards.** Rejected once consent became explicit: a policy change and the migration it permits would need two deploys.
- **A separate `db policy set` command.** Rejected: a pipeline only deploys, and a second way to change a policy is a second path around review.
- **Composer reconciling by itself when no path exists.** Rejected: a failed deploy with a clear recovery is the normal case.
- **Storing policies in a new marker column.** Rejected for `meta.policies`: `meta` exists on all three targets for fields added later, so no marker table changes on existing databases.
