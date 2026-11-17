import { describe, expect, it } from 'vitest';
import { PostgresNativeEnumSchemaNode } from '../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import {
  PostgresSchemaNodeKind,
  postgresDiffSubjectGranularity,
} from '../src/core/schema-ir/schema-node-kinds';

const aalLevel = () =>
  new PostgresNativeEnumSchemaNode({
    typeName: 'aal_level',
    namespaceId: 'auth',
    members: ['aal1', 'aal2', 'aal3'],
  });

describe('PostgresNativeEnumSchemaNode', () => {
  it('carries the postgres-native-enum nodeKind', () => {
    expect(aalLevel().nodeKind).toBe(PostgresSchemaNodeKind.nativeEnum);
  });

  it('id is the kind-prefixed type name, unique among namespace-children siblings', () => {
    expect(aalLevel().id).toBe('native_enum:aal_level');
  });

  it('children() is empty (leaf node)', () => {
    expect(aalLevel().children()).toEqual([]);
  });

  it('is frozen after construction', () => {
    const node = aalLevel();
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.members)).toBe(true);
  });

  it('carries the expected-side control grade when given, absent otherwise', () => {
    const managed = new PostgresNativeEnumSchemaNode({
      typeName: 'aal_level',
      namespaceId: 'auth',
      members: ['aal1'],
      control: 'managed',
    });
    expect(managed.control).toBe('managed');
    expect(Object.hasOwn(aalLevel(), 'control')).toBe(false);
  });

  describe('isEqualTo (ordered members)', () => {
    it('equal ordered members are equal', () => {
      expect(aalLevel().isEqualTo(aalLevel())).toBe(true);
    });

    it('a reorder is NOT equal (Postgres sort order is semantic)', () => {
      const reordered = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal2', 'aal1', 'aal3'],
      });
      expect(aalLevel().isEqualTo(reordered)).toBe(false);
    });

    it('a missing member is not equal', () => {
      const shorter = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2'],
      });
      expect(aalLevel().isEqualTo(shorter)).toBe(false);
    });

    it('an appended member is not equal', () => {
      const longer = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2', 'aal3', 'aal4'],
      });
      expect(aalLevel().isEqualTo(longer)).toBe(false);
    });

    it('a different type name is not equal', () => {
      const otherType = new PostgresNativeEnumSchemaNode({
        typeName: 'factor_type',
        namespaceId: 'auth',
        members: ['aal1', 'aal2', 'aal3'],
      });
      expect(aalLevel().isEqualTo(otherType)).toBe(false);
    });

    it('control does not participate in equality (contract metadata, not database state)', () => {
      const graded = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2', 'aal3'],
        control: 'managed',
      });
      expect(graded.isEqualTo(aalLevel())).toBe(true);
    });
  });

  describe('kind guards', () => {
    it('is() accepts the enum kind and rejects other kinds', () => {
      const role = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: '__unbound__' });
      expect(PostgresNativeEnumSchemaNode.is(aalLevel())).toBe(true);
      expect(PostgresNativeEnumSchemaNode.is(role)).toBe(false);
    });

    it('assert() throws on a non-enum node', () => {
      const role = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: '__unbound__' });
      expect(() => PostgresNativeEnumSchemaNode.assert(role)).toThrow(
        /PostgresNativeEnumSchemaNode/,
      );
    });
  });

  it('granularity map classifies the enum kind as entity (extras strict-gated like tables)', () => {
    expect(postgresDiffSubjectGranularity(PostgresSchemaNodeKind.nativeEnum)).toBe('entity');
  });
});
