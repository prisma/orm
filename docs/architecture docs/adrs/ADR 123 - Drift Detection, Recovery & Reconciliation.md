# ADR 123 — Drift Detection, Recovery & Reconciliation

**Status:** Accepted; its reset recoveries and its "auto-reset" development policy are superseded by [ADR 307 — No recovery resets or drops a database](ADR%20307%20-%20No%20recovery%20resets%20or%20drops%20a%20database.md).

## Context

A database can diverge from the state expected by its Prisma Next contract in many ways:
- Manual DDL changes not via migrations
- Partial migration failures
- Replica lag and caching issues
- Infrastructure accidents (dropped tables, corrupted constraints)
- Marker table corruption or loss
- Multi-service version conflicts

Each drift scenario requires different detection and recovery strategies. Some drifts are easily recoverable (cache invalidation); others require manual intervention (missing critical data).

This ADR defines a comprehensive taxonomy of drift scenarios and recovery operations.

## Drift Taxonomy

### Marker-Level Drifts

These affect the contract marker — the source of truth for database state.

**marker/missing**
- **Description:** No marker row in database
- **Detection:** At startup or on first query
- **Cause:** Database never initialized, marker row deleted, schema migration incomplete
- **Recoverability:** Recoverable (initialization)
- **Implications:** Cannot determine current contract; all queries fail
- **See:** ADR 122 (initialization) for recovery

**marker/corrupt**
- **Description:** Marker row present but data invalid (NULL hashes, invalid JSON, future version)
- **Detection:** At startup during marker validation
- **Cause:** Data corruption, manual edits, version skew
- **Recoverability:** Requires investigation
- **Implications:** Cannot trust marker; conservative strategy: refuse execution
- **Recovery:** Restore from backup or manual reconciliation

**marker/stale**
- **Description:** Marker outdated due to replica lag or stale caching
- **Detection:** Compare against live database state or explicit refresh
- **Cause:** Read replica hasn't replicated latest marker write, client-side cache TTL expired
- **Recoverability:** Recoverable (refresh)
- **Implications:** Temporary inconsistency; queries may reference unavailable tables
- **Recovery:** Invalidate cache, re-read marker from primary

**marker/hash-mismatch**
- **Description:** Marker hash doesn't match applied migration edge hash
- **Detection:** During migrate; marker says H0 but trying to apply H0 → H1 edge
- **Cause:** Edge was applied but marker wasn't updated; edge wasn't applied but marker was
- **Recoverability:** Depends on which is true
- **Recovery:** See transaction/marker-update-failed below

### Schema-Level Drifts

These affect the actual database schema structure.

**schema/manual-ddl**
- **Description:** Direct SQL changes not via Prisma Next migrations
- **Detection:** Introspection; compare current schema to contract
- **Cause:** DBA emergency fixes, debugging scripts, tool-generated DDL
- **Recoverability:** Recoverable (requires analysis)
- **Implications:** Contract and DB are out of sync; queries may fail or behave unexpectedly
- **Recovery Options:**
  1. Plan corrective migration from current state to target
  2. Reset database and reapply migrations
  3. Manual reconciliation with schema review

**schema/partial-apply**
- **Description:** Migration failed mid-way; some operations committed, some rolled back
- **Detection:** Query fails with missing table/column; marker not updated
- **Cause:** DDL statement failed (syntax error, permission denied), transaction rolled back
- **Recoverability:** Depends on operation idempotency (ADR 038)
- **Implications:** Database in inconsistent intermediate state
- **Recovery:**
  - If idempotent: re-run migration (safe, operations will no-op on existing objects)
  - If not idempotent: requires manual remediation (drop partial changes, reset)

**schema/concurrent-apply**
- **Description:** Two migrations applied simultaneously or out of order
- **Detection:** Marker mismatch, missing tables, version conflicts
- **Cause:** Concurrent deployments, race condition in runner
- **Recoverability:** Depends on whether merged state is consistent
- **Implications:** Database in unknown state; queries may fail
- **Recovery:** Coordinate deployments to be sequential; use advisory locks (ADR 043)

### Graph-Level Drifts

These affect the migration graph and reachability.

**dag/orphan-database**
- **Description:** Database has structure but no path to it in migration graph
- **Detection:** Introspection; marker hash doesn't match any graph node
- **Cause:** Database created outside Prisma Next; adopted without baseline; migration graph lost/deleted
- **Recoverability:** Recoverable (initialization or edge creation)
- **Implications:** Cannot plan migrations; application stuck
- **Recovery:**
  1. Create baseline for current state
  2. Or: Introspect, generate contract, create adoption baseline

**dag/no-path**
- **Description:** No migration path exists from current state to target
- **Detection:** Pathfinding fails; no edges connect current marker hash to target
- **Cause:** Target contract doesn't exist in migration graph; parallel edge prevents reachability
- **Recoverability:** Not recoverable without new migration
- **Implications:** Cannot migrate to target; must write new migration or add edge
- **Recovery:** Create new migration from current state to target

**dag/path-breakage**
- **Description:** Marker references a state that no longer exists in the migration graph
- **Detection:** On migrate; edge file deleted or lost
- **Cause:** Migration file deleted; repository history rewritten; incomplete sync
- **Recoverability:** Depends on whether edge can be reconstructed
- **Implications:** Cannot apply next migration; stuck
- **Recovery:** Restore edge from backup or recreate from contract diff

**dag/circular-dependency**
- **Description:** Cycles detected in migration graph (A → B → C → A)
- **Detection:** Pathfinding; cycle detection
- **Cause:** Incorrect edge definitions; manual graph manipulation
- **Recoverability:** Requires correction
- **Implications:** Pathfinding algorithm may fail or behave unexpectedly
- **Recovery:** Remove or redefine edges to break cycle

### Capability Drifts

These affect feature availability.

**capability/missing**
- **Description:** Required capability unavailable (extension not installed)
- **Detection:** At startup or on query execution
- **Cause:** Extension not installed; database doesn't support capability
- **Recoverability:** Requires admin action
- **Implications:** Queries using capability will fail; application may not function
- **Recovery:** Install extension or upgrade database version

**capability/downgrade**
- **Description:** Adapter no longer supports required capability
- **Detection:** At startup during adapter negotiation
- **Cause:** Adapter downgrade; old Prisma code against new database
- **Recoverability:** Requires upgrade
- **Implications:** Cannot execute queries; application fails
- **Recovery:** Upgrade adapter or downgrade database

**profile/mismatch**
- **Description:** Database profileHash differs from expected (capabilities mismatch)
- **Detection:** At startup; compare marker profileHash to contract profileHash
- **Cause:** Database extensions differ; adapter capabilities changed
- **Recoverability:** Depends on differences
- **Implications:** Queries might fail if relying on unavailable capabilities
- **Recovery:** Align extensions or contract capabilities

### Transactional Drifts

These occur when atomic operations fail mid-way.

**transaction/marker-update-failed**
- **Description:** Schema applied successfully but marker update failed
- **Detection:** Query fails; marker hash doesn't match schema
- **Cause:** Marker write permission lost; marker table corrupted; transaction rollback
- **Recoverability:** Recoverable (update marker)
- **Implications:** Next query sees old marker; assumes schema hasn't changed
- **Recovery:** Manually update marker to correct hash; or remove marker and reapply edge

**transaction/partial-commit**
- **Description:** Some operations committed, some rolled back (shouldn't happen with atomic transactions)
- **Detection:** Missing some expected tables/columns after apply
- **Cause:** Database doesn't support atomic DDL; manual intervention mid-transaction
- **Recoverability:** Depends on consistency of partial state
- **Implications:** Database in intermediate inconsistent state
- **Recovery:** Complete rolled-back operations or reset

### Cache/Freshness Drifts

These affect client-side state, not database.

**cache/stale**
- **Description:** Plans cache outdated; contract hash changed since plan was cached
- **Detection:** During plan execution; marker version mismatch
- **Cause:** Contract updated; migration applied; cache TTL expired
- **Recoverability:** Recoverable (cache invalidation)
- **Implications:** May use outdated plan; queries might reference removed columns
- **Recovery:** Invalidate cache entry; re-verify and recompile query

**replica/lag**
- **Description:** Read replica hasn't replicated marker update yet
- **Detection:** Read from replica returns stale marker
- **Cause:** Network lag; replication delay; replica fell behind
- **Recoverability:** Recoverable (wait or redirect to primary)
- **Implications:** Temporary inconsistency; query sees old tables
- **Recovery:** Read marker from primary instead of replica; or wait for replication

### Canonicalization Drifts

These affect schema versioning and compatibility.

**canonical/version-mismatch**
- **Description:** `canonical_version` in marker differs from expected
- **Detection:** At startup; version negotiation (ADR 010)
- **Cause:** Canonicalization rules changed; contract regenerated with new version
- **Recoverability:** Depends on backward compatibility
- **Implications:** May not be able to interpret or apply old migrations
- **Recovery:** Update marker version or recompute contracts with current rules

## Detection Mechanisms

### At Application Startup (Verification Mode: always, onFirstUse)

1. Read marker from database
2. Validate marker structure and hash formats
3. Compare marker hash to current contract hash
4. If mismatch and verification mode is:
   - `always`: Log warning, proceed with re-verification
   - `onFirstUse`: Re-verify once, cache result
   - `never`: Skip all verification

### Before Query Execution

1. Check if query hash matches cache
2. If cache miss: re-verify query against current contract
3. If verification fails: raise error with diagnostics

### Before Migration Apply

1. Verify marker is readable and valid
2. Verify edge file exists and is readable
3. Verify preconditions for each operation
4. Verify marker hash matches edge's `from` hash
5. If any check fails: reject migration

### After Migration Apply

1. Verify all operations succeeded (postconditions)
2. Update marker to new hash
3. Verify marker write successful
4. Log to ledger table

### On Error Conditions

When any query execution fails:
1. Check if error is schema-related (42P01 = table not found, 42703 = column not found)
2. If schema error: potentially drift; optionally re-verify
3. If transient error: retry or escalate

### Optional Manual Introspection (ADR 122)

Developers can manually run introspection:
- Compare current schema to contract
- Detect manual DDL changes
- Generate reconciliation report
- Plan corrective migrations

## Recovery Operations

### marker/missing Recovery

**Status:** Recoverable (initialization)

**Options:**

1. **Initialize from Baseline (Recommended)**
   - Requires: baseline migration H0, contract H0
   - Operation: apply baseline, write marker
   - See: ADR 122 (Initialization Operations)

2. **Introspect and Adopt**
   - Introspect current schema
   - Generate contract from schema
   - Create baseline for current state
   - Initialize marker
   - See: ADR 122 (Brownfield-Conservative Adoption)

### marker/corrupt Recovery

**Status:** Requires investigation

**Options:**

1. **Restore from Backup**
   - Restore marker table from database backup
   - Verify hash against known good value

2. **Manual Reconciliation**
   - Determine current actual contract hash
   - Introspect database
   - Manually compute correct hash
   - Update marker with correct values

3. **Reset to Safe State**
   - Remove marker row (database becomes unmanaged)
   - Introspect and re-adopt (see marker/missing recovery)

### marker/stale Recovery

**Status:** Recoverable (refresh)

**Operation:**
- Invalidate local cache of marker
- Re-read from primary database
- Recompute contract hash if needed
- Proceed with query

### schema/manual-ddl Recovery

**Status:** Recoverable (requires analysis)

**Options:**

1. **Plan Corrective Migration**
   - Introspect current schema
   - Diff current schema to target contract
   - Generate migration: current → target
   - Review for correctness
   - Apply via preflight

2. **Reset and Reapply**
   - Drop database or schema
   - Reapply baseline + all migrations
   - Verify marker
   - Requires downtime

3. **Manual Reconciliation**
   - Review manual DDL changes
   - Decide: keep changes (update contract) or revert
   - If keeping: update contract to match DB
   - If reverting: plan corrective migration to undo

### schema/partial-apply Recovery

**Status:** Recoverable if idempotent (per ADR 038)

**Workflow:**

1. **Classify Operation Idempotency** (ADR 038)
   - Fully idempotent (e.g., CREATE TABLE IF NOT EXISTS)
   - Conditionally idempotent (preconditions needed)
   - Non-idempotent (cannot safely re-run)

2. **If Fully Idempotent:**
   - Re-run migration
   - All CREATE/ALTER operations with IF NOT EXISTS succeed
   - Marker updated
   - Application continues

3. **If Conditionally Idempotent:**
   - Check preconditions (table exists? index doesn't exist?)
   - If preconditions met: re-run
   - If preconditions not met: manual intervention

4. **If Non-Idempotent:**
   - Cannot re-run (unsafe)
   - Options:
     a. Manually complete rolled-back operations
     b. Manually undo committed operations, then re-run
     c. Reset database and start over

### dag/orphan-database Recovery

**Status:** Recoverable (initialization or edge creation)

**Workflow:**

1. **Introspect Current Database**
   - Determine current schema structure
   - Generate potential contract that matches

2. **Search Migration Graph for Matching Contract**
   - Compare introspected schema to known contracts
   - If match found: use that hash as baseline

3. **If No Match:**
   - Create new baseline for current state
   - Add adoption baseline to migration graph
   - Initialize marker with baseline hash

4. **Proceed with Migrations**
   - Now database is connected to migration graph
   - Can plan migrations normally

### dag/no-path Recovery

**Status:** Not recoverable without new edge

**Workflow:**

1. **Determine Goal**
   - What target contract do you want?
   - Verify target contract exists in migration graph

2. **Create New Migration**
   - From: marker's current hash
   - To: target contract hash
   - Plan diff between current and target
   - Generate migration operations

3. **Validate and Apply**
   - Preflight new migration
   - Apply via runner
   - Marker updated to target

### capability/missing Recovery

**Status:** Requires admin action

**Workflow:**

1. **Identify Missing Capability**
   - Error message specifies missing extension/feature
   - Check adapter documentation

2. **Install Extension** (Postgres example)
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

3. **Update Contract** (optional)
   - If contract already specifies capability: no change needed
   - If capability newly available: can update contract to use it

4. **Verify**
   - Re-run startup verification
   - Capability detected and available

## Idempotency and Drift Recovery

### The Idempotency Bridge

Idempotent operations (ADR 038) are critical to drift recovery because they allow safe re-execution of partially-applied migrations.

**How it works:**

If migration fails partway through, causing **schema/partial-apply** drift:
- Some operations succeeded (table created, index exists)
- Some failed (later column addition failed due to constraint violation)
- Database in intermediate state

With idempotent operations:
```sql
-- Idempotent operations from ADR 038
CREATE TABLE IF NOT EXISTS users (id INT);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_email ON users(email);
```

Recovery:
1. Fix underlying issue (e.g., remove conflicting constraint)
2. Re-run migration
3. All CREATE/ALTER operations with IF NOT EXISTS succeed
4. Operations that already completed are no-op
5. Failed operations now succeed
6. Marker updated
7. Database now consistent

**Without idempotency:**
```sql
-- Non-idempotent operations (dangerous to re-run)
CREATE TABLE users (id INT);  -- Fails if exists
ALTER TABLE users ADD COLUMN email TEXT;  -- Fails if exists
CREATE INDEX idx_email ON users(email);  -- Fails if exists
```

Recovery:
1. Manually drop failed changes
2. Fix underlying issue
3. Manually re-run individual failed operations
4. Or: reset database entirely and replay

### Idempotency Classification (ADR 038 Integration)

Operations fall into three categories:

1. **Fully Idempotent**
   - CREATE TABLE IF NOT EXISTS
   - ALTER TABLE ADD COLUMN IF NOT EXISTS
   - CREATE INDEX IF NOT EXISTS
   - Safe to re-run unconditionally
   - Recovery: automatic retry

2. **Conditionally Idempotent**
   - ALTER TABLE MODIFY COLUMN IF EXISTS
   - DROP CONSTRAINT IF EXISTS
   - Requires preconditions to verify state
   - Recovery: verify preconditions, then retry

3. **Non-Idempotent**
   - DROP TABLE (destructive; cannot re-run)
   - ALTER TABLE DROP COLUMN (destructive)
   - Custom trigger logic (may have side effects)
   - Recovery: manual intervention only

### Policy by Environment (ADR 122 Integration)

**Development:**
- Automatic retry on partial-apply (assume idempotent)
- Fast path to debugging
- Introspection on mismatch
- Permissive recovery

**Staging:**
- Retry idempotent operations only
- Classify operation idempotency beforehand
- Require preflight validation
- Detailed logging of retry attempts

**Production:**
- No automatic retry
- Drift halts execution
- Requires explicit manual verification
- Log all drift events for audit
- Escalate to on-call DBA

## Policy Differences by Environment

### Development

**Detection:** Permissive
- Auto-detect marker if missing (quick initialization)
- Allow manual DDL with reconciliation prompts
- Introspect on first mismatch

**Recovery:** Aggressive
- Automatic retry on idempotent operations
- Auto-reset database if needed
- Fast iteration loop

**Logging:** Detailed
- All drift events logged
- Suggestions for resolution
- Introspection reports

### Staging/Testing

**Detection:** Strict
- Require marker; no auto-init
- Validate all hashes
- Detect manual DDL

**Recovery:** Guided
- Preflight required before any migration
- Detailed diagnostics on drift
- Suggest corrective actions

**Logging:** Comprehensive
- All operations logged
- Timeline and causality tracked
- Reports available for review

### Production

**Detection:** Very Strict
- Verify every startup
- Compare marker to contract
- Detect even stale caches

**Recovery:** Manual Only
- Refuse execution on any drift
- No auto-recovery
- Require explicit human action

**Logging:** Audit Trail
- All drift events logged with actor/timestamp
- Immutable audit log
- Compliance reporting
- Escalate to on-call DBA immediately

## Safety Guarantees

### No Data Loss

- Drift recovery never deletes application data
- Only structural changes (schema modifications)
- Rollback always possible (if backups available)

### Preflight Validation

- All recovery operations validated in shadow DB first
- No changes committed until validation succeeds
- Ability to cancel before applying

### Audit Trail

- All marker changes logged with timestamp
- Migration ledger records all applied edges
- Drift events logged with cause and resolution
- Full audit trail for compliance

### Atomic Operations

- Marker updates are atomic (ADR 037)
- If marker update fails: schema not considered applied
- Can safely re-run without side effects

## Related Concepts

- **ADR 001** — Migrations as Edges (foundation for graph-level drifts)
- **ADR 021** — Contract Marker Storage (marker drifts, verification modes)
- **ADR 029** — Shadow DB Preflight Semantics (preflight for corrective migrations)
- **ADR 037** — Transactional DDL Fallback (atomic marker updates, transaction drifts)
- **ADR 038** — Operation Idempotency (classification for recovery)
- **ADR 043** — Advisory Lock Domain & Key Strategy (concurrent apply prevention)
- **ADR 122** — Database Initialization & Adoption (initialization error recovery)
