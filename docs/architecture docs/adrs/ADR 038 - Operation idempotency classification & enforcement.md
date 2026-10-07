# ADR 038 — Operation idempotency classification & enforcement

## Context

The migration runner applies a sequence of operations defined on an edge from `fromHash` to `toHash`. Real databases can be retried, interrupted, or concurrently modified. To remain safe and resumable, each operation must declare whether replays are acceptable and how the runner distinguishes between an operation that is already applied, a true conflict, or a fresh apply.

## Problem

- Without explicit idempotency semantics, a retried migration may partially reapply destructive steps or hide conflicts
- Different operations have different safety characteristics and verification strategies
- The runner needs a uniform way to decide continue, skip, compensate, or fail on every replay scenario

## Goals

- Classify operations by idempotency and define precise pre/post invariants
- Define what "already applied" means per class and how the runner records outcomes
- Specify runner behavior on replays vs true conflicts
- Keep semantics deterministic and auditable in the migration ledger

## Non-goals

- Designing compensation logic for every possible database defect
- Auto-healing external state or application data
- Replacing human review for destructive changes

## Definitions

**Precondition**
A set of checks evaluated before execution that must hold for the operation to be safely applied

**Postcondition**
A set of checks evaluated after execution that must hold if the operation succeeded

**Already applied**
A state where the precondition may no longer hold, but the postcondition fully holds with effects equivalent to a successful apply

**Conflict**
A state where neither pre nor post holds or holds only partially, indicating divergence from the planned edge

## Idempotency classes

### 1. Strictly idempotent (DML/DDL creates with IF NOT EXISTS semantics)

**Examples:** create table/column/index/constraint where the operation guarantees no change if the target already exists with the same definition

- **Pre:** target does not exist OR exists and is definition-equivalent
- **Post:** target exists and matches definition
- **Already applied:** pre fails because it exists, post passes with equivalence
- **Runner action on replay:** mark already_applied, continue

### 2. Effect-idempotent with equivalence check

**Examples:** alter column default, set nullability, set index method when equivalence can be proven via metadata

- **Pre:** current metadata is compatible with change
- **Post:** metadata matches desired spec
- **Already applied:** current metadata equals desired spec
- **Runner action on replay:** verify equivalence, skip if equal, else conflict

The Postgres setDefault op does not follow this pattern: it carries no postcheck and is run again on replay. See ADR 044, "setDefault carries no postcheck".

### 3. Replay-sensitive but bounded by unique identity

**Examples:** insert into ledger tables, enqueue background task with unique opId, create index concurrently without IF NOT EXISTS but with unique name policy

- **Pre:** no prior execution with the same opId in the ledger AND schema compatible
- **Post:** effect observed and ledger entry written with opId
- **Already applied:** ledger contains opId and post holds
- **Runner action on replay:** if ledger says applied and post holds, skip, else conflict

### 4. Non-idempotent requiring explicit guard and compensation plan

**Examples:** destructive DDL (drop table/column), irreversible data transforms

- **Pre:** explicit confirmation flag on the operation and exact match of expected pre-state
- **Post:** exact match of desired post-state and ledger audit captured
- **Already applied:** post holds and ledger carries matching fingerprint of prior apply
- **Runner action on replay:** only skip if ledger fingerprint matches and post holds, otherwise fail and require operator intervention

## Operation schema additions

Every operation must declare:

```json
{
  "op": "addColumn",
  "idempotency": "strict" | "effect" | "unique" | "nonidempotent",
  "pre": [ { "check": "tableExists", "args": { "table": "user" } }, ... ],
  "post": [ { "check": "columnTypeIs", "args": { "table": "user", "column": "age", "type": "int4" } }, ... ],
  "identity": { "opId": "uuid-or-stable-hash" },        // required for idempotency=unique
  "danger": { "confirm": true, "ticket": "ABC-123" }     // required for idempotency=nonidempotent
}
```

Pre/post checks use the per-family check vocabulary ([ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md) for SQL, [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) for Mongo) and must be deterministic.

## What "already applied" means

- **strict:** the observable catalog state is definition-equivalent to the desired effect even if the target already exists
- **effect:** all relevant metadata equals the desired spec, proven by checks
- **unique:** ledger proves a successful prior apply for the same opId and post still holds
- **nonidempotent:** ledger shows the exact same operation fingerprint and post holds

In all cases, "already applied" implies the database is in the intended post-state for that operation with no further action required.

## Runner behavior

For each operation:

1. **Evaluate pre**
   - If pre holds → execute
   - If pre fails:
     - Evaluate post
     - If post holds and class permits → record already_applied, continue
     - If post fails → conflict, halt

2. **Execute the operation** (within the current DDL transaction boundary per ADR 037)
   - On adapter error: emit error with stable code, consider compensation if configured, halt

3. **Evaluate post**
   - If post holds → record applied, continue
   - If post fails → conflict, halt

4. **On replay, consult ledger**
   - If unique: skip when same opId recorded and post holds
   - If nonidempotent: skip only when fingerprint matches and post holds
   - Otherwise follow the pre/post decision tree

## Conflict matrix (summary)

- Pre ✗, Post ✓ → already_applied if class allows, else conflict
- Pre ✓, Execute error → conflict, consider compensation per ADR 037
- Pre ✓, Execute ✓, Post ✗ → conflict
- Ledger says applied but Post ✗ → conflict

## Ledger recording

For each operation, record:

- opId or derived opFingerprint
- Plan edge ID, position, and op kind
- Outcome: applied | already_applied | conflict | error
- Pre/post snapshots and checks evaluated
- Timestamps and runner version

This enables audit, replay decisions, and safe resumption.

## Examples

### Strict

**addIndex with IF NOT EXISTS and canonical name**
- **Pre:** index missing or equivalent
- **Post:** index exists with same definition
- **Replay:** detected as already_applied

### Effect

**alterColumnDefault to 'active'**
- **Pre:** table/column exist and type compatible
- **Post:** default equals 'active'
- **Replay:** if default already 'active', skip

This example is illustrative. The setDefault op carries no postcheck; see ADR 044, "setDefault carries no postcheck".

### Unique

**enqueueBackfillTask**
- **Pre:** no ledger entry with opId
- **Post:** task row exists with opId and expected status
- **Replay:** skip when ledger shows success and post holds

### Non-idempotent

**dropColumn**
- **Pre:** column exists and matches expected type/nullability
- **Post:** column missing and dependent constraints removed
- **Replay:** only skip if ledger and post both prove prior execution

## Rationale

- Explicit classes keep the runner logic simple and auditable
- Pre/post invariants make safety checks uniform across adapters
- Unique identity prevents double-running side-effectful ops
- Non-idempotent gates force deliberate, reviewable actions

## Alternatives considered

- **Treat all ops as effect-idempotent with best-effort checks**
  Too optimistic, risks masking divergence
- **Require operators to mark everything idempotent manually**
  Too error-prone and inconsistent

## Consequences

### Positive

- Safe retries and resumability across failures
- Clear operator signals on conflicts vs harmless replays
- Strong audit trail for compliance

### Negative

- Slightly more verbosity in operation specs
- Some destructive workflows require explicit approvals and can't be auto-replayed

## Implementation notes

- Extend op validators to enforce required fields per idempotency class
- Add opFingerprint = sha256(opKind, normalizedArgs, pre, post) for ledger where opId not provided
- Map runner outcomes to stable errors per ADR 027
- Integrate with transactional boundaries and compensation per ADR 037

## Testing

- Unit tests for each class with success, replay, and conflict paths
- Golden tests for pre/post vocabulary coverage
- Chaos tests that interrupt mid-edge and verify resumability semantics

## References

- ADR 028 — Migration structure & operations
- ADR 037 — Transactional DDL fallback & compensation
- ADR 039 — Migration graph path resolution & integrity
- ADR 028 — Migration structure & operations
- ADR 188 — MongoDB migration operation model
- ADR 027 — Error envelope & stable codes
