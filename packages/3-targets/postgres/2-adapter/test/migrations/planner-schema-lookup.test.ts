import { asNamespaceId } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ForeignKey } from '@internal/sql-contract/types';
import type { SqlTableIRInput } from '@internal/sql-schema-ir/types';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import {
  buildSchemaLookupMap,
  hasForeignKey,
  hasIndex,
  hasUniqueConstraint,
} from '@internal/target-postgres/planner-schema-lookup';
import { describe, expect, it } from 'vitest';

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

describe('buildSchemaLookupMap', () => {
  it('creates a lookup entry for each table', () => {
    const schema = new SqlSchemaIR({
      tables: {
        user: makeTable({ name: 'user' }),
        post: makeTable({ name: 'post' }),
      },
    });
    const map = buildSchemaLookupMap(schema);
    expect(map.size).toBe(2);
    expect(map.has('user')).toBe(true);
    expect(map.has('post')).toBe(true);
  });

  it('populates uniqueKeys from uniques', () => {
    const schema = new SqlSchemaIR({
      tables: {
        user: makeTable({
          uniques: [{ columns: ['email'] }, { columns: ['tenant', 'slug'] }],
        }),
      },
    });
    const lookup = buildSchemaLookupMap(schema).get('user')!;
    expect(lookup.uniqueKeys.has('email')).toBe(true);
    expect(lookup.uniqueKeys.has('tenant,slug')).toBe(true);
  });

  it('populates indexKeys and uniqueIndexKeys from indexes', () => {
    const schema = new SqlSchemaIR({
      tables: {
        user: makeTable({
          indexes: [
            {
              naming: { kind: 'exact', name: 'idx_created_at' },
              columns: ['created_at'],
              where: undefined,
              unique: false,
              partial: false,
              type: undefined,
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
            },
            {
              naming: { kind: 'exact', name: 'idx_email' },
              columns: ['email'],
              where: undefined,
              unique: true,
              partial: false,
              type: undefined,
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
            },
          ],
        }),
      },
    });
    const lookup = buildSchemaLookupMap(schema).get('user')!;
    expect(lookup.indexKeys.has('created_at')).toBe(true);
    expect(lookup.indexKeys.has('email')).toBe(true);
    expect(lookup.uniqueIndexKeys.has('email')).toBe(true);
    expect(lookup.uniqueIndexKeys.has('created_at')).toBe(false);
  });

  it('populates fkKeys with a structurally-unambiguous encoding', () => {
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
    expect(lookup.fkKeys.has(JSON.stringify([['author_id'], 'user', ['id']]))).toBe(true);
  });
});

describe('hasUniqueConstraint', () => {
  const schema = new SqlSchemaIR({
    tables: {
      user: makeTable({
        uniques: [{ columns: ['email'] }],
        indexes: [
          {
            naming: { kind: 'exact', name: 'idx_tenant_slug' },
            columns: ['tenant', 'slug'],
            where: undefined,
            unique: true,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    },
  });
  const lookup = buildSchemaLookupMap(schema).get('user')!;

  it('matches a declared unique constraint', () => {
    expect(hasUniqueConstraint(lookup, ['email'])).toBe(true);
  });

  it('matches a unique index', () => {
    expect(hasUniqueConstraint(lookup, ['tenant', 'slug'])).toBe(true);
  });

  it('rejects non-matching columns', () => {
    expect(hasUniqueConstraint(lookup, ['name'])).toBe(false);
  });

  it('rejects subset of composite unique columns', () => {
    expect(hasUniqueConstraint(lookup, ['tenant'])).toBe(false);
  });
});

describe('hasIndex', () => {
  const schema = new SqlSchemaIR({
    tables: {
      user: makeTable({
        uniques: [{ columns: ['email'] }],
        indexes: [
          {
            naming: { kind: 'exact', name: 'idx_created_at' },
            columns: ['created_at'],
            where: undefined,
            unique: false,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    },
  });
  const lookup = buildSchemaLookupMap(schema).get('user')!;

  it('matches a declared index', () => {
    expect(hasIndex(lookup, ['created_at'])).toBe(true);
  });

  it('matches a unique constraint used as an index', () => {
    expect(hasIndex(lookup, ['email'])).toBe(true);
  });

  it('rejects non-matching columns', () => {
    expect(hasIndex(lookup, ['name'])).toBe(false);
  });
});

describe('hasForeignKey', () => {
  const schema = new SqlSchemaIR({
    tables: {
      post: makeTable({
        foreignKeys: [
          { columns: ['author_id'], referencedTable: 'user', referencedColumns: ['id'] },
          {
            columns: ['org_id', 'team_id'],
            referencedTable: 'team',
            referencedColumns: ['org_id', 'id'],
          },
        ],
      }),
    },
  });
  const lookup = buildSchemaLookupMap(schema).get('post')!;

  const fk = (
    overrides: Partial<ForeignKey> & Pick<ForeignKey, 'source' | 'target'>,
  ): ForeignKey => ({
    ...overrides,
  });

  it('matches a composite FK', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({
          source: {
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            tableName: 'post',
            columns: ['org_id', 'team_id'],
          },
          target: {
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            tableName: 'team',
            columns: ['org_id', 'id'],
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects when referenced table differs', () => {
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
            tableName: 'account',
            columns: ['id'],
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects when referenced columns differ', () => {
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
            columns: ['uid'],
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects when source columns differ', () => {
    expect(
      hasForeignKey(
        lookup,
        fk({
          source: {
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            tableName: 'post',
            columns: ['user_id'],
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
});
