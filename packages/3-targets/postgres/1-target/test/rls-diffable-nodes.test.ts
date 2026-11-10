/**
 * Asserts that PostgresRlsPolicy and PostgresRole are Contract-IR entities only —
 * they do not implement DiffableNode (no `id`, `children`, or `isEqualTo`).
 * The DiffableNode role belongs to PostgresPolicySchemaNode / PostgresRoleSchemaNode.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';
import { policyInputFromSerialized } from '../src/core/serialized-rls-policy';

function policyOf(flat: Parameters<typeof policyInputFromSerialized>[0]): PostgresRlsPolicy {
  return new PostgresRlsPolicy(policyInputFromSerialized(flat));
}

describe('PostgresRlsPolicy — Contract-IR entity, not a DiffableNode', () => {
  const policy = policyOf({
    name: 'read_own_profiles_a1b2c3d4',
    prefix: 'read_own_profiles',
    tableName: 'profiles',
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: "owner_id = current_setting('app.uid')::int",
    permissive: true,
    withCheck: undefined,
  });

  it('has no id property', () => {
    expect('id' in policy).toBe(false);
  });

  it('has no children method', () => {
    expect('children' in policy).toBe(false);
  });

  it('has no isEqualTo method', () => {
    expect('isEqualTo' in policy).toBe(false);
  });

  it('retains kind, name, and all data fields', () => {
    expect(policy.kind).toBe('policy');
    expect(policy.name).toBe('read_own_profiles_a1b2c3d4');
    expect(policy.prefix).toBe('read_own_profiles');
    expect(policy.tableName).toBe('profiles');
    expect(policy.namespaceId).toBe('public');
    expect(policy.operation).toBe('select');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.permissive).toBe(true);
  });

  describe('prefix invariant (wire vs exact)', () => {
    const base = {
      prefix: undefined,
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select' as const,
      roles: ['app_user'],
      using: undefined,
      withCheck: undefined,
      permissive: true,
    };

    it('an exact policy carries no prefix — the property is absent', () => {
      const exact = policyOf({ ...base, name: 'Tenant members can read' });
      expect(exact.prefix).toBeUndefined();
      expect(Object.hasOwn(exact, 'prefix')).toBe(false);
      expect(JSON.parse(JSON.stringify(exact))).not.toHaveProperty('prefix');
    });

    it('a declared prefix must match the wire name', () => {
      expect(() => policyOf({ ...base, name: 'read_own_a1b2c3d4', prefix: 'other' })).toThrow(
        /prefix "other" does not match the wire name/,
      );
      expect(() =>
        policyOf({ ...base, name: 'not_wire_shaped', prefix: 'not_wire_shaped' }),
      ).toThrow(/does not match the wire name/);
    });

    it('an exact name that happens to parse as a wire name stays legal with no prefix claimed', () => {
      const coincidental = policyOf({ ...base, name: 'legacy_ab12cd34' });
      expect(coincidental.prefix).toBeUndefined();
      expect(coincidental.name).toBe('legacy_ab12cd34');
    });
  });
});

describe('PostgresRole — Contract-IR entity, not a DiffableNode', () => {
  const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });

  it('has no id property', () => {
    expect('id' in role).toBe(false);
  });

  it('has no children method', () => {
    expect('children' in role).toBe(false);
  });

  it('has no isEqualTo method', () => {
    expect('isEqualTo' in role).toBe(false);
  });

  it('retains kind, name, and namespaceId', () => {
    expect(role.kind).toBe('role');
    expect(role.name).toBe('app_user');
    expect(role.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });
});
