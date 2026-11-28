# ADR 042 — Contract marker evolution

> **Superseded by [ADR 339](ADR%20339%20-%20Each%20target%20has%20a%20contract%20space%20for%20Prisma%27s%20own%20tables.md).** Prisma's own tables are a contract space the target package carries, and they change by that space's migrations, not by the version check in `meta` this record describes. The columns it added, `canonical_version` and `contract_json`, were never written: on PostgreSQL they are gone, with `app_tag` and `meta`, and each space's marker is a row of `_prisma.signatures` ([ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md)). Contracts are kept, where they are kept, in PostgreSQL's `_prisma.contract`. This record is kept for its history only.

## Context

- The contract marker schema needs to evolve to support contract snapshots and canonicalization versioning
- Existing deployments must be able to upgrade their marker schema without breaking existing functionality
- New fields must be forward-compatible and optional to maintain backward compatibility
- Migration of existing markers must be safe and atomic

## Decision

- Add canonical_version and optional contract_json fields to the forward-compatible marker schema
- Define migration from markers without these columns
- Ensure backward compatibility with existing deployments

## Marker schema evolution

### Current schema (v1)

```sql
create table if not exists prisma_contract.marker (
  id smallint primary key default 1,
  core_hash text not null,
  profile_hash text not null,
  updated_at timestamptz not null default now(),
  app_tag text,
  meta jsonb not null default '{}'
);
```

### Enhanced schema (v2)

```sql
create table if not exists prisma_contract.marker (
  id smallint primary key default 1,
  core_hash text not null,
  profile_hash text not null,
  canonical_version int,
  contract_json jsonb,
  updated_at timestamptz not null default now(),
  app_tag text,
  meta jsonb not null default '{}'
);
```

## Migration strategy

### Automatic migration

- The migration runner detects marker schema version and upgrades automatically
- Migration is performed atomically within the same transaction as edge application
- New columns are added as nullable to maintain backward compatibility
- Existing data is preserved unchanged

### Migration steps

1. Check marker schema version in meta field
2. If version < 2, add new columns:
   - `ALTER TABLE prisma_contract.marker ADD COLUMN canonical_version int;`
   - `ALTER TABLE prisma_contract.marker ADD COLUMN contract_json jsonb;`
3. Update meta field to record schema version: 2
4. Continue with normal edge application

## Backward compatibility

### Existing deployments

- Older runtimes continue to work with v1 marker schema
- New columns are ignored by older clients
- No breaking changes to existing functionality
- Gradual adoption of new features as deployments upgrade

## Field semantics

### canonical_version

- Records the canonicalization version used for contract_json
- Defaults to 1 for existing contracts without this field
- Used for contract validation and drift detection
- Must match the canonicalVersion in contract.json when present

### contract_json

- Optional complete contract JSON for drift analysis and PPg features
- Can be null (off), compressed, or full based on contractStorage setting
- Must be canonical JSON when present
- Used for contract reconstruction and visualization

## Validation rules

### Contract consistency

- If contract_json is present, its coreHash must match core_hash
- If contract_json is present, its canonicalVersion must match canonical_version
- Runtime validates consistency on marker reads
- Inconsistencies are reported as contract/marker-inconsistent errors

## Upgrade safety

### Atomic operations

- Schema migration and edge application happen in the same transaction
- If migration fails, edge application is rolled back
- No partial state where schema is upgraded but edge fails

### Rollback support

- Schema downgrade is not supported (breaking change)
- New columns can be set to null to disable new features
- Existing functionality remains unaffected

## Configuration

### Runtime configuration

```typescript
createRuntime({
  contract,
  adapter,
  driver,
  verify: 'startup' | 'onFirstUse' | 'always',
  contractStorage?: 'off' | 'compressed' | 'full',
  markerUpgrade?: 'auto' | 'manual' | 'disabled'
})
```

### Migration runner configuration

```typescript
createRunner({
  adapter,
  adminDriver,
  markerUpgrade: {
    enabled: true,
    version: 2,
    contractStorage: 'full'
  }
})
```

## Testing

### Migration tests

- Test migration from v1 to v2 marker schema
- Test backward compatibility with older runtimes
- Test contract consistency validation
- Test rollback scenarios

### Integration tests

- Test marker upgrade during edge application
- Test contract storage modes (off/compressed/full)
- Test validation with inconsistent marker data

## Performance impact

### Minimal overhead

- New columns are nullable and don't affect existing queries
- Contract JSON storage is optional and configurable
- No performance impact on existing deployments
- Gradual adoption allows teams to evaluate storage requirements

## Security considerations

### No secrets in marker

- Contract JSON contains only structure, no sensitive data
- Marker remains safe for replication and backup
- Access controls unchanged from existing schema

## Open questions

- Whether to support schema downgrade for emergency rollbacks
- Policy for handling inconsistent marker data in production
- Integration with PPg contract storage features

## Decision record

- Add canonical_version and contract_json fields to marker schema v2
- Provide automatic migration path from v1 to v2
- Maintain backward compatibility with existing deployments
- Enable contract snapshots and enhanced drift analysis

### Runtime read-side behaviour (TML-2680)

The SQL runtime's response to marker drift on read has shifted from throwing blocking errors to emitting a structured `warn`-level log line once per runtime and proceeding with the query. This does not change marker schema, write paths, or the explicit `db-verify` CLI verification surface — only the runtime's lazy read-side diagnostic during normal query execution.
