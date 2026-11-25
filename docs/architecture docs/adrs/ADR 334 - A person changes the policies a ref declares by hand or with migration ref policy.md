# ADR 334 — A person changes a ref's policies, by hand or with `migration ref policy`

**Status:** Accepted
**Date:** 2026-11-25
**Amends:** [ADR 320 — Databases record a change policy and a data protection policy](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)

## At a glance

A team wants production to change only through migrations and never to lose data. It declares that in production's ref with one command, instead of typing the long values into the JSON by hand:

```text
$ prisma migration ref policy set production --change migrate --data-loss forbidden
✔ Updated the policies ref production declares (migrations/app/refs/production.json)

change:                   migrate, reconcile (default)  →  migrate  tightens
dataProtection.dataLoss:  data-loss-with-consent (default)  →  data-loss-forbidden  tightens

ℹ No database was changed. A database takes on these policies only when its owner applies them in a deploy to production; until then, deploys to production refuse while the database's policies differ. prisma migration plan --to production now checks plans against dataProtection.dataLoss.
```

The command rewrites only `migrations/app/refs/production.json`. The database takes on the policies when its owner deploys to production with `--permit-policy-change`, as [ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md) describes. `migration ref policy show` prints what a ref declares, and `migration ref policy delete` removes a setting so the ref declares nothing about it.

## Decision

ADR 320 said that only a person editing the file changes a ref's policies. This record changes that to: **a person changes them, by hand or with the `migration ref policy` commands, and no command changes a ref's policies as a side effect of doing something else.** `migration ref set`, `db migrate`, `db update` and `db sign` keep a ref's policies as they are.

ADR 320 also said that every command that rewrites a ref keeps the fields it does not change. This record narrows it to: **every ref writer keeps the fields the ref format defines** (`hash`, `invariants`, `policies`). A top-level key the format does not define is dropped on rewrite, which is what every ref writer already does.

**No advice points to these commands.** No error, next action or command output, and no advice in the `prisma-8` skill, tells the reader to loosen a ref's policies or points to these commands as a way past a refusal, whether it names them or describes what they do. No output of the commands names `--permit-policy-change`. The help of `set` and `delete` says that a refused deploy or plan is not a reason to loosen a ref's policies. Reference documentation may name the commands: the skill's description of the ref file and its commands, the CLI's README and help, and these design documents.

## Why the commands are acceptable

The commands write the working copy of the ref file, which a deploy then reads. They can do nothing that editing the file by hand cannot. A database still takes on a ref's policies only in a deploy its owner gives consent to. ADR 320 already lists "edit the ref, then give consent" as a deliberate workaround the policies do not try to stop: they stop mistakes. The commands make a mistaken edit less likely, because they reject an invalid value before touching the file and label every change that loosens a policy `loosens`.

## Why no advice names them

An agent that has just been refused acts on whatever the error offers it. An error that pointed to a command that loosens the ref would have that agent loosen production's policies to get its deploy through, which is the mistake ADR 320 exists to stop. So the advice for a refusal fixes what was refused. `MIGRATION.POLICY_MISMATCH` advises making the ref declare what the database has only where that makes the ref stricter, and otherwise advises having the database's owner apply the ref's policies in a deploy.

## Consequences

- The operations behind the commands are not part of the control API. A pipeline only deploys, so a program has no reason to rewrite a ref's policies.
- The ref file format does not change, and editing the file by hand keeps working.
- The `prisma-8` skill documents the commands as reference, beside the ref file format, and names them in its guidance only to say they are not a way past a refusal. A later agent that finds them in the skill should keep that documentation, not remove it: what is ruled out is advice that sends a refused reader to them.
- A source check in the CLI's tests fails if any file under a package's `src` other than the commands and the place the CLI mounts them names the commands. It covers the code that produces errors, next actions and output; the skill and the docs, which may name the commands as reference, are outside it, and their advice is checked by review.

## Alternatives considered

- **Policy flags on `migration ref set`.** Rejected: `ref set` points a ref at a contract and checks the contract against the migration graph. Policy flags would give it a second job, and an agent sent to `ref set` while recovering from a refusal would see how to loosen a policy.
- **A database command, `db policy set`.** Rejected by ADR 320 and still rejected: it would change a database's policies outside a deploy. These commands change only the ref.
- **Keeping unknown top-level keys and hand formatting on rewrite.** Rejected for now: it would make these commands behave differently from every other ref writer. Changing it is a change to the ref file writer.
