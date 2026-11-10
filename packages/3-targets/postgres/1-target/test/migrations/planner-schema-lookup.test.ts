import { asNamespaceId } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ForeignKey } from '@internal/sql-contract/types';
import type { SqlTableIRInput } from '@internal/sql-schema-ir/types';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  buildSchemaLookupMap,
  hasForeignKey,
} from '../../src/core/migrations/planner-schema-lookup';

function makeTable(overrides: Partial<SqlTableIRInput> = {}): SqlSchemaIR['tables'][string] {
  return new SqlTableIR({
    name: 'test',
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  });
}

function fk(overrides: Partial<ForeignKey> & Pick<ForeignKey, 'source' | 'target'>): ForeignKey {
  return {
    ...overrides,
  };
}

describe('hasForeignKey — key encoding', () => {
  describe('happy paths', () => {
    it('matches an unbound-namespace FK against the unqualified key', () => {
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [
              { columns: ['author_id'], referencedTable: 'user', referencedColumns: ['id'] },
            ],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['author_id'],
            },
            target: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'user',
              columns: ['id'],
            },
          }),
        ),
      ).toBe(true);
    });

    it('matches a bound-namespace FK against the qualified key when referencedSchema matches', () => {
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [
              {
                columns: ['author_id'],
                referencedSchema: 'auth',
                referencedTable: 'user',
                referencedColumns: ['id'],
              },
            ],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['author_id'],
            },
            target: { namespaceId: asNamespaceId('auth'), tableName: 'user', columns: ['id'] },
          }),
        ),
      ).toBe(true);
    });

    it('rejects a bound-namespace FK when namespaceId does not match referencedSchema', () => {
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [
              {
                columns: ['author_id'],
                referencedSchema: 'auth',
                referencedTable: 'user',
                referencedColumns: ['id'],
              },
            ],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['author_id'],
            },
            target: { namespaceId: asNamespaceId('analytics'), tableName: 'user', columns: ['id'] },
          }),
        ),
      ).toBe(false);
    });
  });

  describe('identifiers containing the encoding separator', () => {
    it('matches identifiers containing a single pipe character', () => {
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [
              {
                columns: ['weird|col'],
                referencedTable: 'weird|table',
                referencedColumns: ['id|col'],
              },
            ],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['weird|col'],
            },
            target: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'weird|table',
              columns: ['id|col'],
            },
          }),
        ),
      ).toBe(true);
    });

    it('matches identifiers containing the doubled-pipe sequence', () => {
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [
              {
                columns: ['weird||col'],
                referencedTable: 'weird||table',
                referencedColumns: ['id||col'],
              },
            ],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['weird||col'],
            },
            target: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'weird||table',
              columns: ['id||col'],
            },
          }),
        ),
      ).toBe(true);
    });
  });

  describe('cross-key collisions (must not match)', () => {
    it('does not let a column literally named "a,b" collide with a composite of ["a", "b"]', () => {
      // The schema stores an FK whose source is a single column literally
      // named "a,b" — a contrived but legal Postgres quoted identifier.
      // A separate FK with composite source columns ["a", "b"] must NOT
      // match the stored entry: they are structurally distinct, even though
      // a comma-join encoding would conflate them.
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [{ columns: ['a,b'], referencedTable: 'user', referencedColumns: ['id'] }],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['a', 'b'],
            },
            target: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'user',
              columns: ['id'],
            },
          }),
        ),
      ).toBe(false);
    });

    it('does not let pipe characters straddle the qualified schema/table boundary', () => {
      // Stored FK: referencedSchema='p|q', referencedTable='r'.
      // Lookup FK: namespaceId='p',     tableName='q|r'.
      // A pipe-separator encoding would render both as 'a|p|q|r|s', a false
      // positive. They are structurally distinct and must not collide.
      const schema = new SqlSchemaIR({
        tables: {
          post: makeTable({
            foreignKeys: [
              {
                columns: ['a'],
                referencedSchema: 'p|q',
                referencedTable: 'r',
                referencedColumns: ['s'],
              },
            ],
          }),
        },
      });
      const lookup = buildSchemaLookupMap(schema).get('post')!;
      expect(
        hasForeignKey(
          lookup,
          fk({
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'post',
              columns: ['a'],
            },
            target: { namespaceId: asNamespaceId('p'), tableName: 'q|r', columns: ['s'] },
          }),
        ),
      ).toBe(false);
    });
  });
});
