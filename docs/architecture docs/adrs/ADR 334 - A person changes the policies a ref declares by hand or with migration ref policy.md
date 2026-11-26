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

ℹ No database was changed. Deploys to production refuse while the database's policies differ from these. prisma migration plan --to production now checks plans against dataProtection.dataLoss.
```

The command rewrites only `migrations/app/refs/production.json`. The database takes on the policies when its owner deploys to production with `--permit-policy-change`, as [ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md) describes. `migration ref policy show` prints what a ref declares, and `migration ref policy delete` removes a setting so the ref declares nothing about it.

## Decision

ADR 320 said that only a person editing the file changes a ref's policies. This record changes that to: **a person changes them, by hand or with the `migration ref policy` commands, and no command changes a ref's policies as a side effect of doing something else.** `migration ref set`, `db migrate`, `db update` and `db sign` keep a ref's policies as they are.

ADR 320 also said that every command that rewrites a ref keeps the fields it does not change. This record narrows it to: **every ref writer keeps the fields the ref format defines** (`formatVersion`, `hash`, `invariants`, `policies`). A ref file with a field the format does not define is refused when it is read, as [ADR 331](ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md) decides for every stored file, so a command fails with `MIGRATION.INVALID_REF_FILE` and leaves the file as it was. No writer drops a field a person added.

**No advice suggests a policy change.** No error, next action, command output or skill advice suggests changing a database's or a ref's policies, in either direction and by anyone, the owner included, whether it names these commands or describes what they do. A refusal says what was refused and how to fix the refused work; a mismatch states the difference and says to report it to whoever owns the database. No output of the commands names `--permit-policy-change`. The help of `set` and `delete` says that a refused deploy or plan is not a reason to change a ref's policies. Reference documentation may describe, as facts, how policies are changed and may name the commands: the skill's description of the ref file and its commands, the CLI's README and help, and these design documents. It never does so as a response to a refusal or a mismatch.

## Why the commands are acceptable

The commands write the working copy of the ref file, which a deploy then reads. They can do nothing that editing the file by hand cannot. A database still takes on a ref's policies only in a deploy its owner gives consent to. ADR 320 already lists "edit the ref, then give consent" as a deliberate workaround the policies do not try to stop: they stop mistakes. The commands make a mistaken edit less likely, because they reject an invalid value before touching the file and label every change that loosens a policy `loosens`.

## Why no advice suggests a policy change

The policies stop changes the team did not intend. An agent that has just been refused acts on whatever the error offers it, so any suggestion to change a policy, even to tighten it or to have the owner change it, becomes a way forward that agent takes. A policy changes because the team decides to, never because an error suggested it. So the advice for a refusal fixes the refused work, and `MIGRATION.POLICY_MISMATCH` states the differences and says nothing runs while they remain: "Nothing runs while production declares policies that differ from the database's. Report the difference to whoever owns the database."

## Consequences

- The operations behind the commands are not part of the control API. A pipeline only deploys, so a program has no reason to rewrite a ref's policies.
- The ref file format does not change, and editing the file by hand keeps working.
- The `prisma-8` skill documents the commands as reference, beside the ref file format, and names them in its guidance only to say they are not a way past a refusal. Its advice for a refusal or a mismatch is to fix the refused work or tell the user, never to change a policy. A later agent that finds them in the skill should keep that documentation, not remove it: what is ruled out is advice that sends a refused reader to them.
- A test over every policy error the CLI builds, for every command and source, fails if its fix or next actions suggest changing or applying a policy.
- A source check in the CLI's tests fails if any file under a package's `src` other than the commands and the place the CLI mounts them names the commands. It covers the code that produces errors, next actions and output; the skill and the docs, which may name the commands as reference, are outside it, and their advice is checked by review.

## Alternatives considered

- **Policy flags on `migration ref set`.** Rejected: `ref set` points a ref at a contract and checks the contract against the migration graph. Policy flags would give it a second job, and an agent sent to `ref set` while recovering from a refusal would see how to loosen a policy.
- **A database command, `db policy set`.** Rejected by ADR 320 and still rejected: it would change a database's policies outside a deploy. These commands change only the ref.
- **Keeping unknown top-level keys on rewrite, or dropping them.** Rejected: a ref reader refuses a field the format does not define, as ADR 331 decides, so neither case reaches a writer.
- **Keeping hand formatting on rewrite.** Rejected for now: it would make these commands behave differently from every other ref writer. Changing it is a change to the ref file writer.
