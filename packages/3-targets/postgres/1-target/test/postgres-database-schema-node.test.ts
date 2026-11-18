import { diffSchemas } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  PostgresDatabaseSchemaNode,
  type PostgresDatabaseSchemaNodeInput,
} from '../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';
import { introspectedColumn } from './postgres-type-lookups';

const tableA = new PostgresTableSchemaNode({
  name: 'profiles',
  columns: { id: introspectedColumn({ name: 'id', typeText: 'int4', nullable: false }) },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
  rlsEnabled: false,
});

const nsPublic = new PostgresNamespaceSchemaNode({
  schemaName: 'public',
  tables: { profiles: tableA },
});

const nsApp = new PostgresNamespaceSchemaNode({
  schemaName: 'app',
  tables: {},
});

const role = new PostgresRoleSchemaNode({
  name: 'app_user',
  namespaceId: UNBOUND_NAMESPACE_ID,
});

const baseInput: PostgresDatabaseSchemaNodeInput = {
  namespaces: { public: nsPublic, app: nsApp },
  roles: [role],
  extensions: undefined,
  existingSchemas: ['public', 'app'],
  pgVersion: '15.2',
};

describe('PostgresDatabaseSchemaNode', () => {
  it('id returns fixed sentinel "database"', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.id).toBe('database');
  });

  it('isEqualTo matches by id (roots always share the "database" id)', () => {
    const a = new PostgresDatabaseSchemaNode(baseInput);
    const b = new PostgresDatabaseSchemaNode({ ...baseInput, pgVersion: '16.0' });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('children() yields namespace nodes followed by role nodes', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.children()).toEqual([nsPublic, nsApp, role]);
  });

  it('a role id may equal a same-named schema id — the differ pairs by (nodeKind, id), not id alone', () => {
    const publicRole = new PostgresRoleSchemaNode({
      name: 'public',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    expect(publicRole.id).toBe(nsPublic.id);
    expect(publicRole.id).toBe('public');
    expect(publicRole.nodeKind).not.toBe(nsPublic.nodeKind);
  });

  it('diffs a role alongside a same-named schema without the duplicate-id throw', () => {
    // Root with a schema named `public` AND a role named `public`. The differ
    // pairs siblings by (nodeKind, id), so the shared bare id `public` does
    // not collide — role and namespace are different nodeKinds.
    const collidingRole = new PostgresRoleSchemaNode({
      name: 'public',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    const expected = new PostgresDatabaseSchemaNode({
      extensions: undefined,
      namespaces: { public: nsPublic },
      roles: [collidingRole],
      existingSchemas: ['public'],
      pgVersion: '15.2',
    });
    const actual = new PostgresDatabaseSchemaNode({
      extensions: undefined,
      namespaces: { public: nsPublic },
      roles: [collidingRole],
      existingSchemas: ['public'],
      pgVersion: '15.2',
    });
    // No throw, and identical trees produce no issues.
    expect(() => diffSchemas(expected, actual)).not.toThrow();
    expect(diffSchemas(expected, actual)).toEqual([]);
  });

  it('instance is frozen', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('nodeKind discriminant is "postgres-database"', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.nodeKind).toBe('postgres-database');
  });

  describe('PostgresDatabaseSchemaNode.is', () => {
    it('returns true for a PostgresDatabaseSchemaNode', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(PostgresDatabaseSchemaNode.is(node)).toBe(true);
    });

    it('returns true for a spread plain object that retains nodeKind', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      const spread = { ...node };
      expect(PostgresDatabaseSchemaNode.is(spread as unknown as SqlSchemaIRNode)).toBe(true);
    });

    it('returns false for a PostgresNamespaceSchemaNode', () => {
      expect(PostgresDatabaseSchemaNode.is(nsPublic as unknown as SqlSchemaIRNode)).toBe(false);
    });

    it('returns false for an object without nodeKind', () => {
      const bare = { id: 'database' } as unknown as SqlSchemaIRNode;
      expect(PostgresDatabaseSchemaNode.is(bare)).toBe(false);
    });
  });

  describe('PostgresDatabaseSchemaNode.assert', () => {
    it('does not throw for a valid node', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(() => PostgresDatabaseSchemaNode.assert(node)).not.toThrow();
    });

    it('throws for an object with wrong nodeKind', () => {
      const bad = { nodeKind: 'postgres-namespace' } as unknown as SqlSchemaIRNode;
      expect(() => PostgresDatabaseSchemaNode.assert(bad)).toThrow();
    });
  });
});
