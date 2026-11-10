# ADR 204 — Domain actions vs composable primitives in the control plane

## At a glance

The control plane exposes two kinds of operations through `ControlFamilyInstance`. Look at the interface and the difference is visible in the return types alone:

```ts
export interface ControlFamilyInstance<TFamilyId extends string, TSchemaIR>
  extends FamilyInstance<TFamilyId> {
  verify(options: { ... }): Promise<VerifyDatabaseResult>;
  schemaVerify(options: { ... }): Promise<VerifyDatabaseSchemaResult>;

  validateContract(contractJson: unknown): Contract;
  introspect(options: { ... }): Promise<TSchemaIR>;
  readMarker(options: { ... }): Promise<ContractMarkerRecord | null>;
}
```

The first two return CLI-shaped result envelopes (`...Result` types with `summary`, `code`, `meta.contractPath`, `timings`). They model **domain actions** — single intents an actor performs (`prisma-next db verify`, `migrate`'s top-level call). Each is the right boundary for one analytics event, one audit record, one CLI render. `prisma-next db sign` is an action too, but the CLI composes it from family primitives (`readAllMarkers`, `verifySchema` and `signSpaces`), so the family has no `sign` method.

The other three return raw data — a `Contract`, a `MongoSchemaIR`, a `ContractMarkerRecord | null`. They model **composable primitives** — pure or bounded I/O steps with no actor-intent attached, suitable for composition inside larger work.

The rule:

> **Compound domain actions compose primitives. They do not call peer domain actions.**

When a compound action needs the same logic that a peer action implements, the shared logic must be extracted as a primitive. Both actions then compose it.

## Context

`ControlFamilyInstance` mixes both shapes deliberately. Every family must expose the same set of high-level intents (verify, schemaVerify, …) so the CLI and other family-agnostic orchestrators can stay generic; every family must also expose primitives (introspect, readMarker, validateContract) so compound work can reuse the underlying capabilities without rebuilding them.

The mix invites a recurring mistake. When a compound action needs to perform something that a peer action already does, the natural reach is to call the peer action — `family.schemaVerify(...)` from inside the migration runner, for example. The call type-checks, the result is structured, and there's no obvious red flag.

The mistake compounds at the audit/observability layer. Every domain action emits one event with caller-provided context (which CLI command issued it, which contract path, which config path). A compound action that delegates to a peer action emits two events for one user intent, with the inner one carrying meaningless or fabricated metadata (the runner has no `contractPath` to forward — it's mid-execution). Telemetry doublecounts; logs read as if the user ran two commands. The same problem appears in any future cross-cutting concern bound to action boundaries — rate limits, idempotency keys, distributed tracing.

The principle is older than this codebase: actions are not composable. They are the boundary where a compound's children stop being meaningful as their own intents and start being implementation steps. Primitives are what compounds compose.

## Decision

**The control plane separates domain actions from composable primitives. Compound actions compose primitives only.**

### How to tell which is which

| Signal | Domain action | Composable primitive |
|---|---|---|
| Return shape | CLI/audit envelope (`...Result` with `summary`, `code`, `meta`, `timings`) | Raw data (IR, marker record, contract, `void`) |
| Inputs | Caller-context fields like `contractPath`, `configPath`, `expectedTargetId` | Just the data needed to do the work |
| Audit boundary | Emits one event/log/trace span per call | Does not emit audit events |
| Caller | A user, an agent, the CLI, or a compound action's outer entry point | A compound action's internal step, or another primitive |

If a method's signature requires CLI metadata (`contractPath`), or its return value carries `summary`/`code`/`timings`, it's an action. Don't call it from a peer action.

### Composing primitives inside an action

A domain action's body reduces to three steps: validate inputs, compose primitives, wrap result.

```ts
async schemaVerify(options): Promise<VerifyDatabaseSchemaResult> {
  const validated = validateMongoContract<MongoContract>(options.contract);

  const live = await introspectSchema(extractDb(options.driver));
  const result = verifyMongoSchema({
    contract: validated.contract,
    schema: live,
    strict: options.strict,
    frameworkComponents: options.frameworkComponents,
  });

  return wrapVerifyResult(result, {
    contractPath: options.contractPath,
    configPath: options.configPath,
    timings: { total: Date.now() - startTime },
  });
}
```

The pure verifier (`verifyMongoSchema`) and the introspection step (`introspectSchema`) are primitives. Anywhere else that needs the same logic — a runner's post-apply check, a planner's drift detection, a test — composes them directly.

### Where the primitives live

Primitives belong at the lowest layer that hosts their type dependencies (per [ADR 185](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md)). For control-plane primitives, that's typically the family core layer:

- `family.introspect` — already exposed on `ControlFamilyInstance`
- `verifyMongoSchema` / `verifySqlSchema` — pure functions in the family package, exported via dedicated `/schema-verify` entry points
- `contractToMongoSchemaIR` / `contractToSchemaIR` — pure functions in the family package
- `diffMongoSchemas` / SQL diff equivalents — pure helpers used internally by the verifiers

When a compound action discovers that it needs an action's internal logic and there is no primitive to compose, the fix is to **extract the primitive**, then refactor the action to compose it. Both call sites converge on one canonical implementation.

## Worked example

The mistake this ADR was written to prevent: the Mongo migration runner needs post-apply schema verification. `MongoControlFamilyInstance.schemaVerify` already implements introspect-then-diff. The tempting wiring is to inject the family instance into the runner and call `family.schemaVerify(...)` from the runner's `execute()` body.

That's wrong. `migrate` is itself a compound domain action — one user intent, one audit boundary at the runner's outer entry. Reaching into a peer action mid-flow gives that single user intent two action boundaries with two sets of CLI metadata, only one of which is real. It also imports an action's coupling to CLI rendering into a context that has no CLI to render to.

The correct wiring extracts the primitive first. `verifyMongoSchema(contract, schema, strict, frameworkComponents)` is the pure step that both `db verify --schema-only` and the runner need. Once it exists:

- `MongoControlFamilyInstance.schemaVerify` reduces to: validate the contract, call `family.introspect` for the live schema, call `verifyMongoSchema`, wrap the result in a `VerifyDatabaseSchemaResult` envelope with the CLI metadata.
- The runner's post-apply step calls `family.introspect` (or an equivalent introspection primitive) for the live schema and `verifyMongoSchema` for the diff. It returns the result inside its own (already-existing) `runnerFailure(...)` / `runnerSuccess(...)` envelope at the runner's natural action boundary.

Both sites share one canonical pure verifier. Each site emits its own audit event at its own action layer. Adding a third compound action that needs the same check (a future drift-detection daemon, a CI preflight) costs zero new copies of the verify logic.

## Consequences

- **Single canonical implementation per logical operation.** When two callers need the same step, the step is a primitive both compose; no caller copies an action's body.
- **Audit boundaries are stable.** One user intent → one analytics event / log line / trace span. Compound actions emit at their outer boundary only.
- **Action signatures stay honest.** An action takes the metadata it actually emits (`contractPath`, `configPath`); a primitive takes only the data it transforms. Type mismatches at composition sites surface the layering mistake before code review.
- **Actions are explicitly reducible.** Reviewing an action method, its body is essentially "validate, compose primitives, wrap." Any logic past that signal is a primitive that hasn't been extracted yet.
- **Compound action plumbing changes are localized.** When the runner gains a new internal step (verify, validate hashes, emit telemetry), it composes a primitive — no peer-action surface needs to change.

## Why not the alternatives?

**Let compound actions call peer actions when convenient.** Smaller diffs in the moment, but doublecounts the user intent at every cross-cutting concern (analytics, audit, distributed tracing, idempotency keys, rate limits). The shape of the action signature already advertises that it expects to be the audit boundary; calling it nested violates that contract silently.

**Inline the logic in each compound action.** Avoids reaching across into a peer action, but produces multiple implementations of the same logic that drift over time. Mongo's pre-ADR state had `MongoFamilyInstance.schemaVerify` inline its own diff; once a runner needs the same diff, the choice is "duplicate it again" or "extract a primitive." The ADR's answer is always extract.

**Make all `ControlFamilyInstance` methods primitives and move the envelope construction to the CLI.** Cleanly separates layers but loses generic dispatch — every CLI command becomes family-aware again, defeating the purpose of `ControlFamilyInstance`. Keeping actions on the family interface preserves the generic CLI surface; the cost is the discipline this ADR imposes.

## Status

Accepted.

## Related

- [ADR 005 — Thin Core Fat Targets](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — establishes that target-specific behavior lives in family/target packages, including the primitives this ADR governs.
- [ADR 151 — Control Plane Descriptors and Instances](ADR%20151%20-%20Control%20Plane%20Descriptors%20and%20Instances.md) — defines the descriptor/instance pattern that `ControlFamilyInstance` participates in.
- [ADR 185 — SPI types live at the lowest consuming layer](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — same layering principle applied to where primitive types live.
- [ADR 198 — Runner decoupled from driver via visitor SPIs](ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md) — primitives may be wired into runners as deps callbacks; this ADR clarifies which side of the actions/primitives split each callback belongs to.
