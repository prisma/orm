import type { Contract } from '@internal/contract/types';
import type { VerifyDatabaseSchemaResult } from '@internal/framework-components/control';
import { issueOutcome, PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import type { ContractMarkerRecordLike } from '../../src/aggregate/marker-types';
import type { AggregateContractSpace, ContractSpaceAggregate } from '../../src/aggregate/types';
import type {
  SchemaEntityKindClassifier,
  SchemaSubjectClassifier,
} from '../../src/aggregate/unclaimed-elements';
import { verifyMigration } from '../../src/aggregate/verifier';
import { makeAggregateContractSpace } from '../fixtures';

function makeSpace(args: {
  spaceId: string;
  headHash: string;
  invariants?: readonly string[];
  tables?: Record<string, unknown>;
}): AggregateContractSpace {
  const tables = args.tables ?? {};
  const contract = createSqlContract({
    target: 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
      },
    },
  });
  return makeAggregateContractSpace({
    spaceId: args.spaceId,
    contract: contract as Contract,
    headRef: { hash: args.headHash, invariants: args.invariants ?? [] },
  });
}

function makeAggregate(args: {
  app: AggregateContractSpace;
  extensions?: AggregateContractSpace[];
}): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app: args.app,
    extensions: args.extensions ?? [],
    checkIntegrity: () => [],
  });
}

/**
 * A per-space verifier standing in for a family's: it verifies the space's
 * contract against the **full** live schema and flags every live table the
 * space does not declare as an `extra_table` warning — exactly the shape the
 * real family verify produces before the aggregate verifier scopes it.
 */
const FULL_SCHEMA_VERIFY = (
  schema: unknown,
  space: AggregateContractSpace,
  _mode: 'strict' | 'lenient',
): VerifyDatabaseSchemaResult => {
  const liveTables = Object.keys((schema as { tables?: Record<string, unknown> })?.tables ?? {});
  const declared = new Set(
    Object.keys(space.contract().storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['table'] ?? {}),
  );
  const extras = liveTables.filter((name) => !declared.has(name));
  return {
    ok: true,
    summary: 'Database schema satisfies contract',
    contract: { storageHash: 'test' },
    target: { expected: 'postgres' },
    schema: {
      issues: extras.map((name) => ({
        path: [name],
        // Actual-only: an extra live table is a drop, which `issueOutcome` derives from presence.
        actual: { id: name, nodeKind: 'table', isEqualTo: () => true, children: () => [] },
        message: `Extra table "${name}"`,
      })),
    },
    timings: { total: 0 },
  };
};

/**
 * The classifier fixtures standing in for a real family's
 * `hasSchemaSubjectClassifier` capability: every `FULL_SCHEMA_VERIFY` issue
 * is a bare single-segment path naming a whole table, so both classifiers
 * resolve it the same way regardless of path shape.
 */
const CLASSIFY_SUBJECT_GRANULARITY: SchemaSubjectClassifier = () => 'entity';
const CLASSIFY_ENTITY_KIND: SchemaEntityKindClassifier = () => 'table';

function extraTables(result: VerifyDatabaseSchemaResult | undefined): string[] {
  return (result?.schema.issues ?? [])
    .flatMap((issue) =>
      issueOutcome(issue) === 'not-expected' && issue.path.length === 1 ? [issue.path[0]] : [],
    )
    .filter((name): name is string => name !== undefined)
    .sort();
}

describe('verifyMigration', () => {
  describe('markerCheck', () => {
    it('reports `absent` when the space has no marker row', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'app-head' }),
      });
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });
      expect(result.ok).toBe(true);
      expect(result.assertOk().markerCheck.perSpace.get('app')).toEqual({ kind: 'absent' });
    });

    it('reports `ok` when marker hash + invariants match the head ref', () => {
      const aggregate = makeAggregate({
        app: makeSpace({
          spaceId: 'app',
          headHash: 'app-head',
          invariants: ['inv-1'],
        }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'app-head', invariants: ['inv-1'] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });
      expect(result.assertOk().markerCheck.perSpace.get('app')).toEqual({ kind: 'ok' });
    });

    it('reports `hashMismatch` when marker hash differs from head ref', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'expected' }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'actual', invariants: [] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });
      expect(result.assertOk().markerCheck.perSpace.get('app')).toEqual({
        kind: 'hashMismatch',
        markerHash: 'actual',
        expected: 'expected',
      });
    });

    it('reports `missingInvariants` when the head ref declares invariants the marker lacks', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h' }),
        extensions: [
          makeSpace({
            spaceId: 'cipher',
            headHash: 'cipher',
            invariants: ['cipher:create-v1', 'cipher:rotate-v1'],
          }),
        ],
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['cipher', { storageHash: 'cipher', invariants: ['cipher:create-v1'] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });
      expect(result.assertOk().markerCheck.perSpace.get('cipher')).toEqual({
        kind: 'missingInvariants',
        missing: ['cipher:rotate-v1'],
      });
    });

    it('lists orphan markers (rows for non-aggregate spaces)', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h' }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'h', invariants: [] }],
        ['cipher', { storageHash: 'cipher', invariants: [] }],
        ['vector', { storageHash: 'vector', invariants: [] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });
      expect(result.assertOk().markerCheck.orphanMarkers.map((o) => o.spaceId)).toEqual([
        'cipher',
        'vector',
      ]);
    });

    it("counts the row of the space for Prisma's own tables as declared", () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h' }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'h', invariants: [] }],
        [PRISMA_SPACE_ID, { storageHash: 'prisma-tables', invariants: [] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });
      expect(result.assertOk().markerCheck).toEqual({
        perSpace: new Map([['app', { kind: 'ok' }]]),
        orphanMarkers: [],
      });
    });
  });

  describe('schemaCheck', () => {
    it('each space view shows its declared nodes only, no extras', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h', tables: { user: {} } }),
        extensions: [
          makeSpace({
            spaceId: 'cipher',
            headHash: 'cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });
      const liveSchema = {
        tables: {
          user: { columns: {} },
          cipher_state: { columns: {} },
          orphan_table: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      // No space's contract-satisfaction view carries the undeclared table
      // (nor a sibling's table) — extras are stripped from every per-space view.
      expect(extraTables(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(extraTables(schemaCheck.perSpace.get('cipher'))).toEqual([]);
    });

    it('reports a table no space declares once in the unclaimed list', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h', tables: { user: {} } }),
        extensions: [
          makeSpace({
            spaceId: 'cipher',
            headHash: 'cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });
      const liveSchema = {
        tables: {
          user: { columns: {} },
          cipher_state: { columns: {} },
          orphan_table: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });

      // `orphan_table` is declared by no space, so it appears exactly once —
      // not once per space, the bug the two-part split fixes.
      expect(result.assertOk().schemaCheck.unclaimed).toEqual(['orphan_table']);
    });

    it('deduplicates and sorts multiple undeclared tables into one list', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h', tables: { user: {} } }),
        extensions: [
          makeSpace({
            spaceId: 'cipher',
            headHash: 'cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });
      const liveSchema = {
        tables: {
          user: { columns: {} },
          cipher_state: { columns: {} },
          mystery_table: { columns: {} },
          another_orphan: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'lenient',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });

      expect(result.assertOk().schemaCheck.unclaimed).toEqual(['another_orphan', 'mystery_table']);
    });

    it('single-space: an undeclared table is unclaimed, not a node in the space view', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h', tables: { user: {} } }),
      });
      const liveSchema = {
        tables: { user: { columns: {} }, legacy_events: { columns: {} } },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      expect(extraTables(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(schemaCheck.unclaimed).toEqual(['legacy_events']);
    });

    it('leaves the unclaimed list empty when every live table is declared by some space', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h', tables: { user: {} } }),
        extensions: [
          makeSpace({
            spaceId: 'cipher',
            headHash: 'cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: {
          tables: {
            user: { columns: {} },
            cipher_state: { columns: {} },
          },
        },
        mode: 'strict',
        verifySchemaForSpace: FULL_SCHEMA_VERIFY,
        classifySubjectGranularity: CLASSIFY_SUBJECT_GRANULARITY,
        classifyEntityKind: CLASSIFY_ENTITY_KIND,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      expect(extraTables(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(extraTables(schemaCheck.perSpace.get('cipher'))).toEqual([]);
      expect(schemaCheck.unclaimed).toEqual([]);
    });

    it('returns notOk(introspectionFailure) when verifySchemaForSpace throws', () => {
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h', tables: { user: {} } }),
      });

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: { user: { columns: {} } } },
        mode: 'strict',
        verifySchemaForSpace: () => {
          throw new Error('introspection broke');
        },
      });

      expect(result.ok).toBe(false);
      expect(result.assertNotOk()).toEqual({
        kind: 'introspectionFailure',
        detail: 'introspection broke',
      });
    });

    it('threads the verifier mode (strict / lenient) to the per-space callback verbatim', () => {
      let observedMode: 'strict' | 'lenient' | undefined;
      const aggregate = makeAggregate({
        app: makeSpace({ spaceId: 'app', headHash: 'h' }),
      });

      verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
        mode: 'lenient',
        verifySchemaForSpace: (schema, space, mode) => {
          observedMode = mode;
          return FULL_SCHEMA_VERIFY(schema, space, mode);
        },
      });

      expect(observedMode).toBe('lenient');
    });
  });
});
