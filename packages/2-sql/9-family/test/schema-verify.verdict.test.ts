/**
 * Differ verdict suite: for every scenario class the verify flow grades
 * (basic drift, constraints, checks, defaults, referential actions, uniques
 * and indexes under structural equality, strict extras, control policies,
 * storage types), the generic-differ verify flow must produce the pinned
 * VERDICT in both strict and lenient modes, with the drift keyed on reason +
 * node.
 *
 * Each scenario builds: contract→flat expected tree (resolved leaf values
 * stamped) vs the actual tree stamped the way introspection stamps it,
 * diffed by `diffSchemas` over the trees as derived (no pre-diff pass),
 * graded by `computeSqlDiffVerdict` + `computeStorageTypeVerdict`.
 */

import type { ColumnDefault, Contract, ControlPolicy } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { diffSchemas, issueOutcome } from '@internal/framework-components/control';
import { entityAt } from '@internal/framework-components/ir';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOf } from '@internal/sql-schema-ir/naming';
import {
  relationalNodeGranularity,
  SqlColumnIR,
  SqlSchemaIR,
  SqlTableIR,
} from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { extractCodecControlHooks } from '../src/core/assembly';
import { computeSqlDiffVerdict, computeStorageTypeVerdict } from '../src/core/diff/schema-verify';
import type { DefaultNormalizer, NativeTypeNormalizer } from '../src/core/diff/sql-schema-diff';
import { contractToSchemaIR } from '../src/core/migrations/contract-to-schema-ir';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
} from './schema-verify.helpers';

const testNormalizer: DefaultNormalizer = (rawDefault: string): ColumnDefault | undefined => {
  const trimmed = rawDefault.trim();
  if (/^(now\s*\(\s*\)|CURRENT_TIMESTAMP)$/i.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', value: Number(trimmed) };
  }
  const stringMatch = trimmed.match(/^'((?:[^']|'')*)'(?:::(?:"[^"]+"|[\w\s]+)(?:\(\d+\))?)?$/);
  if (stringMatch?.[1] !== undefined) {
    return { kind: 'literal', value: stringMatch[1].replace(/''/g, "'") };
  }
  if (trimmed === 'unparseable()') return undefined;
  return { kind: 'function', expression: trimmed };
};

const identityNativeNormalizer: NativeTypeNormalizer = (nativeType: string) =>
  nativeType === 'varchar' ? 'character varying' : nativeType;

/** Stamps resolved values onto a raw actual tree the way introspection does. */
function stampLikeIntrospection(schema: SqlSchemaIR): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [name, table] of Object.entries(schema.tables)) {
    const columns: Record<string, SqlColumnIR> = {};
    for (const [colName, col] of Object.entries(table.columns)) {
      const resolvedNativeType = `${identityNativeNormalizer(col.nativeType)}${col.many ? '[]' : ''}`;
      const resolvedDefault =
        col.default !== undefined ? testNormalizer(col.default, resolvedNativeType) : undefined;
      columns[colName] = new SqlColumnIR({
        name: col.name,
        nativeType: col.nativeType,
        nullable: col.nullable,
        ...(col.default !== undefined ? { default: col.default } : {}),
        ...(col.many !== undefined ? { many: col.many } : {}),
        resolvedNativeType,
        ...(resolvedDefault !== undefined ? { resolvedDefault } : {}),
      });
    }
    tables[name] = new SqlTableIR({
      name: table.name,
      columns,
      foreignKeys: table.foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
    });
  }
  return new SqlSchemaIR({ tables });
}

interface VerdictRun {
  readonly ok: boolean;
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

/**
 * Resolves a verdict-diff issue's subject table's declared control policy
 * directly from the contract — mirrors the flat-tree resolution
 * `diffSqliteSchema` performs for the real SQLite target.
 */
function resolveControlPolicy(
  issue: SchemaDiffIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy | undefined {
  const tableName = issue.path[1];
  if (tableName === undefined) return undefined;
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const table = entityAt<StorageTable>(contract.storage, {
      namespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (table !== undefined) return table.control;
  }
  return undefined;
}

function runVerdict(options: {
  readonly contract: ReturnType<typeof createTestContract>;
  readonly schema: SqlSchemaIR;
  readonly strict: boolean;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): VerdictRun {
  const frameworkComponents = options.frameworkComponents ?? [];

  const expected = contractToSchemaIR(options.contract, {
    annotationNamespace: 'pg',
  });
  const actual = stampLikeIntrospection(options.schema);
  const issues = diffSchemas(expected, actual);
  const diffVerdict = computeSqlDiffVerdict({
    issues,
    resolveControlPolicy: (issue) => resolveControlPolicy(issue, options.contract),
    strict: options.strict,
    defaultControlPolicy: options.contract.defaultControlPolicy,
    granularityOf: relationalNodeGranularity,
  });
  const namespacesWithTables = Object.values(options.contract.storage.namespaces).filter(
    (ns) => Object.keys(ns.entries.table ?? {}).length > 0,
  );
  const typeVerdict = computeStorageTypeVerdict({
    contract: options.contract,
    namespacePairs: namespacesWithTables.map(() => ({ actual })),
    codecHooks: extractCodecControlHooks(frameworkComponents),
  });
  return {
    ok: diffVerdict.failures.length === 0 && typeVerdict.failures.length === 0,
    failures: [...diffVerdict.failures, ...typeVerdict.failures],
    warnings: [...diffVerdict.warnings, ...typeVerdict.warnings],
  };
}

/** Runs the verdict in both strict and lenient modes. */
function runBothModes(options: {
  readonly contract: ReturnType<typeof createTestContract>;
  readonly schema: SqlSchemaIR;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): { readonly strict: VerdictRun; readonly lenient: VerdictRun } {
  const strict = runVerdict({ ...options, strict: true });
  const lenient = runVerdict({ ...options, strict: false });
  return { strict, lenient };
}

function failureOutcomesByNodeKind(run: VerdictRun): ReadonlyArray<readonly [string, string]> {
  return run.failures.map((issue) => {
    const node = issue.expected ?? issue.actual;
    const nodeKind = (node as { nodeKind?: string } | undefined)?.nodeKind ?? 'unknown';
    return [nodeKind, issueOutcome(issue)] as const;
  });
}

describe('differ verdict — basic drift', () => {
  it('identical schema verifies in both modes', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
    expect(lenient.ok).toBe(true);
  });

  it('missing table fails both modes as not-found', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const schema = createTestSchemaIR({});
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-table', 'not-found']);
  });

  it('extra table fails strict only', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      stray: createSchemaTable('stray', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(true);
    expect(failureOutcomesByNodeKind(strict)).toContainEqual(['sql-table', 'not-expected']);
  });

  it('missing column fails both modes; extra column fails strict only', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        email: { nativeType: 'text', nullable: false },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        stray: { nativeType: 'text', nullable: true },
      }),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-column', 'not-found']);
    expect(failureOutcomesByNodeKind(strict)).toContainEqual(['sql-column', 'not-expected']);
    expect(failureOutcomesByNodeKind(lenient)).not.toContainEqual(['sql-column', 'not-expected']);
  });

  it('type mismatch and nullability mismatch fail both modes as not-equal', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        email: { nativeType: 'text', nullable: false },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int8', nullable: false },
        email: { nativeType: 'text', nullable: true },
      }),
    });
    const { lenient } = runBothModes({ contract, schema });
    expect(lenient.ok).toBe(false);
    const reasons = failureOutcomesByNodeKind(lenient);
    expect(reasons.filter(([kind]) => kind === 'sql-column')).toHaveLength(2);
  });

  it('normalized native types verify (varchar vs character varying)', () => {
    const contract = createTestContract({
      user: createContractTable({ name: { nativeType: 'character varying', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { name: { nativeType: 'varchar', nullable: false } }),
    });
    const { strict } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
  });
});

describe('differ verdict — defaults (default is a child node of the column)', () => {
  it('matching literal default verifies', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'draft'::text" },
      }),
    });
    const { strict } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
  });

  it('default missing fails BOTH modes as not-found on the default node', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { status: { nativeType: 'text', nullable: false } }),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-column-default', 'not-found']);
  });

  it('default mismatch fails both modes as not-equal on the default node', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'published'::text" },
      }),
    });
    const { lenient } = runBothModes({ contract, schema });
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-column-default', 'not-equal']);
  });

  it('EXTRA default fails strict only (the reason-lifecycle case that forced the node design)', () => {
    const contract = createTestContract({
      user: createContractTable({ status: { nativeType: 'text', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'draft'::text" },
      }),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(true);
    expect(failureOutcomesByNodeKind(strict)).toContainEqual([
      'sql-column-default',
      'not-expected',
    ]);
  });

  it('function default matches case-insensitively', () => {
    const contract = createTestContract({
      user: createContractTable({
        created: {
          nativeType: 'timestamptz',
          codecId: 'pg/timestamptz-temporal@1',
          nullable: false,
          default: { kind: 'function', expression: 'now()' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        created: { nativeType: 'timestamptz', nullable: false, default: 'CURRENT_TIMESTAMP' },
      }),
    });
    const { strict } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
  });

  it('an unparseable live default against a declared one fails', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: 'unparseable()' },
      }),
    });
    const { lenient } = runBothModes({ contract, schema });
    expect(lenient.ok).toBe(false);
  });
});

describe('differ verdict — primary keys', () => {
  const contractWithPk = () =>
    createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
    });

  it('matching PK verifies; PK name differences are ignored', () => {
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'], name: 'user_pkey' } },
      ),
    });
    const { strict } = runBothModes({ contract: contractWithPk(), schema });
    expect(strict.ok).toBe(true);
  });

  it('missing PK fails both modes; extra PK fails strict only', () => {
    const missing = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { lenient } = runBothModes({ contract: contractWithPk(), schema: missing });
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-primary-key', 'not-found']);

    const contractNoPk = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
    });
    const extra = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
    });
    const runs = runBothModes({ contract: contractNoPk, schema: extra });
    expect(runs.strict.ok).toBe(false);
    expect(runs.lenient.ok).toBe(true);
  });

  it('PK column drift fails both modes', () => {
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        {
          id: { nativeType: 'int4', nullable: false },
          tenant: { nativeType: 'int4', nullable: false },
        },
        { primaryKey: { columns: ['tenant', 'id'] } },
      ),
    });
    const contract = createTestContract({
      user: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          tenant: { nativeType: 'int4', nullable: false },
        },
        { primaryKey: { columns: ['id'] } },
      ),
    });
    const { lenient } = runBothModes({ contract, schema });
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-primary-key', 'not-equal']);
  });
});

describe('differ verdict — foreign keys', () => {
  const NS = '__unbound__';
  const contractWithFk = (actions?: { onDelete?: 'cascade' | 'noAction' }) =>
    createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          user_id: { nativeType: 'int4', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { namespaceId: NS, tableName: 'post', columns: ['user_id'] },
              target: { namespaceId: NS, tableName: 'user', columns: ['id'] },
              ...(actions?.onDelete !== undefined ? { onDelete: actions.onDelete } : {}),
            },
          ],
          // FK1: the backing index for a default (`index: true`) FK is a
          // discrete, named entity materialized at contract emit — no longer
          // derived here by `contractToSchemaIR`, so the fixture carries it
          // explicitly, matching what `buildSqlContractFromDefinition` would
          // have produced.
          indexes: [{ columns: ['user_id'], name: 'post_user_id_idx', unique: false }],
        },
      ),
    });

  const schemaWithFk = (options?: {
    readonly onDelete?: 'cascade' | 'noAction' | 'restrict';
    readonly omitFk?: boolean;
    readonly omitBackingIndex?: boolean;
  }) =>
    createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { primaryKey: { columns: ['id'] } },
      ),
      post: createSchemaTable(
        'post',
        {
          id: { nativeType: 'int4', nullable: false },
          user_id: { nativeType: 'int4', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          foreignKeys: options?.omitFk
            ? []
            : [
                {
                  columns: ['user_id'],
                  referencedTable: 'user',
                  referencedColumns: ['id'],
                  ...(options?.onDelete !== undefined ? { onDelete: options.onDelete } : {}),
                },
              ],
          indexes: options?.omitBackingIndex
            ? []
            : [{ columns: ['user_id'], unique: false, name: 'post_user_id_idx' }],
        },
      ),
    });

  it('matching FK (unbound contract vs schema-less live FK) verifies — id pairing', () => {
    const { strict } = runBothModes({ contract: contractWithFk(), schema: schemaWithFk() });
    expect(strict.ok).toBe(true);
  });

  it('missing FK fails both modes', () => {
    const { lenient } = runBothModes({
      contract: contractWithFk(),
      schema: schemaWithFk({ omitFk: true }),
    });
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-foreign-key', 'not-found']);
  });

  it('fk-backing index expectation: live DB missing the backing index fails both modes', () => {
    const { lenient } = runBothModes({
      contract: contractWithFk(),
      schema: schemaWithFk({ omitBackingIndex: true }),
    });
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-index', 'not-found']);
  });

  it('referential-action directionality: undeclared expected never flags live actions', () => {
    const { strict } = runBothModes({
      contract: contractWithFk(),
      schema: schemaWithFk({ onDelete: 'cascade' }),
    });
    expect(strict.ok).toBe(true);
  });

  it('referential-action directionality: declared expected flags divergent live action', () => {
    const { lenient } = runBothModes({
      contract: contractWithFk({ onDelete: 'cascade' }),
      schema: schemaWithFk({ onDelete: 'restrict' }),
    });
    expect(lenient.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-foreign-key', 'not-equal']);
  });

  it('referential-action noAction is equivalent to undeclared on both sides', () => {
    const noActionExpected = runBothModes({
      contract: contractWithFk({ onDelete: 'noAction' }),
      schema: schemaWithFk({ onDelete: 'cascade' }),
    });
    expect(noActionExpected.strict.ok).toBe(true);

    const noActionActual = runBothModes({
      contract: contractWithFk({ onDelete: 'cascade' }),
      schema: schemaWithFk({ onDelete: 'noAction' }),
    });
    expect(noActionActual.strict.ok).toBe(false);
  });
});

describe('differ verdict — uniques and indexes (structural equality)', () => {
  it('contract @@unique matched by a live unique CONSTRAINT is clean (the round-trip)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'], name: 'user_email_key' }] },
      ),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
    expect(lenient.ok).toBe(true);
  });

  it('contract @@unique vs a live unique INDEX fails both modes (constraint missing + index extra)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ columns: ['email'], unique: true, name: 'user_email_key' }] },
      ),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    // The unique constraint is missing (fails both modes); the undeclared
    // unique index is an ordinary extra (strict-only).
    expect(lenient.ok).toBe(false);
    expect(strict.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-unique', 'not-found']);
    expect(failureOutcomesByNodeKind(strict)).toContainEqual(['sql-index', 'not-expected']);
  });

  it('contract @@index vs a live unique CONSTRAINT fails both modes (index missing + constraint extra)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'], name: 'user_email_key' }] },
      ),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(lenient.ok).toBe(false);
    expect(strict.ok).toBe(false);
    expect(failureOutcomesByNodeKind(lenient)).toContainEqual(['sql-index', 'not-found']);
    expect(failureOutcomesByNodeKind(strict)).toContainEqual(['sql-unique', 'not-expected']);
  });

  it('contract @@index (with a type) vs a live unique constraint fails both modes', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false, type: 'gin' }] },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const { lenient } = runBothModes({ contract, schema });
    expect(lenient.ok).toBe(false);
  });

  it('a stray live unique INDEX is an ordinary extra: strict-fails / lenient-passes', () => {
    const contract = createTestContract({
      user: createContractTable({ email: { nativeType: 'text', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ name: 'user_email_key_idx', columns: ['email'], unique: true }] },
      ),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(true);
    expect(failureOutcomesByNodeKind(strict)).toContainEqual(['sql-index', 'not-expected']);
  });

  it('a stray live non-unique index is an extra in strict only', () => {
    const contract = createTestContract({
      user: createContractTable({ email: { nativeType: 'text', nullable: false } }),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }] },
      ),
    });
    const runs = runBothModes({ contract, schema });
    expect(runs.strict.ok).toBe(false);
    expect(runs.lenient.ok).toBe(true);
  });

  it('missing unique fails both modes; stray live unique constraint is strict-only', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const missing = createTestSchemaIR({
      user: createSchemaTable('user', { email: { nativeType: 'text', nullable: false } }),
    });
    const missingRuns = runBothModes({ contract, schema: missing });
    expect(missingRuns.lenient.ok).toBe(false);

    const contractNone = createTestContract({
      user: createContractTable({ email: { nativeType: 'text', nullable: false } }),
    });
    const stray = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        { uniques: [{ columns: ['email'] }] },
      ),
    });
    const strayRuns = runBothModes({ contract: contractNone, schema: stray });
    expect(strayRuns.strict.ok).toBe(false);
    expect(strayRuns.lenient.ok).toBe(true);
  });

  it('index options compare loosely (typed contract vs stringly introspection)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'text', nullable: false } },
        {
          indexes: [
            {
              name: 'user_email_idx',
              columns: ['email'],
              unique: false,
              options: { fillfactor: 70 },
            },
          ],
        },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { email: { nativeType: 'text', nullable: false } },
        {
          indexes: [
            {
              name: 'user_email_idx',
              columns: ['email'],
              unique: false,
              options: { fillfactor: '70' },
            },
          ],
        },
      ),
    });
    const { strict } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
  });
});

describe('differ verdict — check constraints', () => {
  const postWithChecks = (
    checks: ReadonlyArray<{ name: string; prefix?: string; expression: string }>,
  ) =>
    new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: { status: { name: 'status', nativeType: 'text', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: checks.map((c) => ({
            naming: namingOf(c.name, c.prefix),
            expression: c.expression,
            dependsOn: undefined,
          })),
        },
      },
    });

  const checkIssues = (expected: SqlSchemaIR, actual: SqlSchemaIR, name: string) =>
    diffSchemas(expected, actual).filter((i) => i.path.includes(`check:${name}`));

  it('an exact-named check whose expression drifted is not-equal', () => {
    const issues = checkIssues(
      postWithChecks([{ name: 'post_status_check', expression: `"status" IN ('a', 'b')` }]),
      postWithChecks([{ name: 'post_status_check', expression: `"status" IN ('a', 'c')` }]),
      'post_status_check',
    );
    expect(issues).toHaveLength(1);
    expect(issueOutcome(issues[0]!)).toBe('not-equal');
  });

  it('a wire-named check pairs by name, so a reprinted expression is not drift', () => {
    const wire = { name: 'post_status_check_0a1b2c3d', prefix: 'post_status_check' };
    const issues = checkIssues(
      postWithChecks([{ ...wire, expression: `"status" IN ('a', 'b')` }]),
      postWithChecks([{ ...wire, expression: `(status = ANY (ARRAY['a'::text, 'b'::text]))` }]),
      wire.name,
    );
    expect(issues).toHaveLength(0);
  });

  it('a wire-named check pairs by name even when the live value set differs', () => {
    // The consequence of comparing names only, stated as its own case: the
    // live body here is a faithful reprint that has lost a member (on `text` a
    // one-member `IN` collapses to `=`), and it is still not reported.
    const wire = { name: 'post_status_check_0a1b2c3d', prefix: 'post_status_check' };
    const issues = checkIssues(
      postWithChecks([{ ...wire, expression: `"status" IN ('a', 'b')` }]),
      postWithChecks([{ ...wire, expression: `(status = 'a'::text)` }]),
      wire.name,
    );
    expect(issues).toHaveLength(0);
  });

  it('a declared check the database lacks is not-found', () => {
    const issues = checkIssues(
      postWithChecks([{ name: 'post_status_check', expression: `"status" IN ('a')` }]),
      postWithChecks([]),
      'post_status_check',
    );
    expect(issueOutcome(issues[0]!)).toBe('not-found');
  });

  it('a live-only check is a strict-gated extra', () => {
    const issues = checkIssues(
      postWithChecks([]),
      postWithChecks([{ name: 'post_status_check', expression: `"status" IN ('a')` }]),
      'post_status_check',
    );
    expect(issueOutcome(issues[0]!)).toBe('not-expected');

    const verdictFor = (strict: boolean) =>
      computeSqlDiffVerdict({
        issues,
        resolveControlPolicy: () => undefined,
        strict,
        defaultControlPolicy: undefined,
        granularityOf: relationalNodeGranularity,
      });
    expect(verdictFor(true).failures).toHaveLength(1);
    expect(verdictFor(false).failures).toHaveLength(0);
  });
});

describe('differ verdict — control policies', () => {
  it('an observed table warns instead of failing (both modes pass)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { control: 'observed' },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int8', nullable: false } }),
    });
    const { strict, lenient } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings.length).toBeGreaterThan(0);
  });

  it('an external table suppresses extras but still fails declared drift', () => {
    const contract = createTestContract({
      user: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
        },
        { control: 'external' },
      ),
    });
    const extras = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        stray: { nativeType: 'text', nullable: true },
      }),
    });
    const extraRuns = runBothModes({ contract, schema: extras });
    expect(extraRuns.strict.ok).toBe(true);

    const drift = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int8', nullable: false } }),
    });
    const driftRuns = runBothModes({ contract, schema: drift });
    expect(driftRuns.lenient.ok).toBe(false);
  });

  it('a tolerated table suppresses extra columns only', () => {
    const contract = createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { control: 'tolerated' },
      ),
    });
    const extraColumn = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
        stray: { nativeType: 'text', nullable: true },
      }),
    });
    const columnRuns = runBothModes({ contract, schema: extraColumn });
    expect(columnRuns.strict.ok).toBe(true);

    const extraIndex = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        { indexes: [{ name: 'user_id_idx', columns: ['id'], unique: false }] },
      ),
    });
    const indexRuns = runBothModes({ contract, schema: extraIndex });
    expect(indexRuns.strict.ok).toBe(false);
  });

  it('a defaultControlPolicy of observed downgrades an extra table to a warning', () => {
    const contract = createTestContract(
      {
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      },
      {},
      undefined,
      { defaultControlPolicy: 'observed' as ControlPolicy },
    );
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      stray: createSchemaTable('stray', { id: { nativeType: 'int4', nullable: false } }),
    });
    const { strict } = runBothModes({ contract, schema });
    expect(strict.ok).toBe(true);
    expect(strict.warnings.length).toBeGreaterThan(0);
  });
});

describe('differ verdict — storage types (verifyType hook)', () => {
  function typeComponent(
    issues: readonly SchemaDiffIssue[],
  ): TargetBoundComponentDescriptor<'sql', string> {
    return {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'type-hook-test',
      version: '0.0.0',
      types: {
        codecTypes: {
          controlPlaneHooks: {
            'app/enum@1': {
              verifyType: () => issues,
            },
          },
        },
      },
    } as TargetBoundComponentDescriptor<'sql', string>;
  }

  function contractWithType(): ReturnType<typeof createTestContract> {
    return createTestContract(
      { user: createContractTable({ id: { nativeType: 'int4', nullable: false } }) },
      {},
      {
        user_status: {
          kind: 'codec-instance',
          codecId: 'app/enum@1',
          nativeType: 'user_status',
          typeParams: { values: ['a'] },
        },
      },
    );
  }

  const matchingSchema = () =>
    createTestSchemaIR({
      user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
    });

  it('a verifyType failure fails the verdict in both modes', () => {
    // Both sides present → an alter (value drift), which fails under managed.
    const node = { id: 'user_status', nodeKind: 'x', isEqualTo: () => true, children: () => [] };
    const components = [typeComponent([{ path: ['user_status'], expected: node, actual: node }])];
    const { strict, lenient } = runBothModes({
      contract: contractWithType(),
      schema: matchingSchema(),
      frameworkComponents: components,
    });
    expect(strict.ok).toBe(false);
    expect(lenient.ok).toBe(false);
  });

  it('a clean verifyType hook keeps the verdict green', () => {
    const components = [typeComponent([])];
    const { strict } = runBothModes({
      contract: contractWithType(),
      schema: matchingSchema(),
      frameworkComponents: components,
    });
    expect(strict.ok).toBe(true);
  });
});
