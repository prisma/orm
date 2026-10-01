/**
 * TS brand foundation + cross-space FK (storage plane)
 *
 * Tests for cross-contract foreign key lowering: model-handle branding,
 * cross-space FK lowering (including chained handles), missing-pack diagnostics,
 * cascade-action passthrough, and local-FK regression.
 */
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract, field, model } from '../src/contract-builder';
import type { TargetFieldRef } from '../src/contract-dsl';
import { ContractModelBuilder } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';
import { unboundTables } from './unbound-tables';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

/** A synthetic supabase extension pack ref for in-test use. */
const supabasePack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'supabase',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

/**
 * A synthetic branded extension model handle representing `auth.User` in the
 * `supabase` contract space, built directly in the test.
 *
 * The handle is a `ContractModelBuilder` branded with `spaceId: 'supabase'`,
 * then chained with `.sql({ table: 'users' })`.
 * The table name `users` differs from `modelName.toLowerCase()` (`user`), making
 * the `tableName` assertion non-coincidental.
 */
function buildSyntheticSupabaseAuthUser() {
  return new ContractModelBuilder(
    {
      modelName: 'User' as const,
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
      relations: {},
    },
    undefined,
    undefined,
    'supabase' as const,
  ).sql({ table: 'users' });
}

/** A local User model for NFR2 regression tests. */
function buildLocalUserModel() {
  return model('User', {
    fields: {
      id: field.column(int4Column).id(),
      email: field.column(textColumn),
    },
  }).sql({ table: 'user' });
}

/** A local Post model referencing the local User via constraints.foreignKey — for NFR2 regression. */
function buildLocalPostModel(User: ReturnType<typeof buildLocalUserModel>) {
  return model('Post', {
    fields: {
      id: field.column(int4Column).id(),
      userId: field.column(int4Column),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'post',
    foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
  }));
}

// ---------------------------------------------------------------------------
// Type-level tests
// ---------------------------------------------------------------------------

describe('TargetFieldRef brand (type-level)', () => {
  it('a local model produces refs branded "<self>"', () => {
    const User = model('User', {
      fields: { id: field.column(int4Column).id() },
    });
    expectTypeOf(User.refs.id).toEqualTypeOf<TargetFieldRef<'User', 'id', '<self>'>>();
  });

  it('a synthetic extension handle produces refs branded with the spaceId', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();
    expectTypeOf(ExtUser.refs.id).toEqualTypeOf<TargetFieldRef<'User', 'id', 'supabase'>>();
  });

  it('brand survives .sql() chaining — chained handle still carries the spaceId', () => {
    // Build the handle using the staged pattern.
    const ExtUser = new ContractModelBuilder(
      {
        modelName: 'User' as const,
        namespace: 'auth',
        fields: { id: field.column(int4Column).id() },
        relations: {},
      },
      undefined,
      undefined,
      'supabase' as const,
    ).sql({ table: 'users' });
    // The TSpaceId brand must still be 'supabase' after chaining through .sql().
    expectTypeOf(ExtUser.refs.id).toEqualTypeOf<TargetFieldRef<'User', 'id', 'supabase'>>();
    // Runtime: spaceId and tableName must be present on the ref.
    expect(ExtUser.refs.id.spaceId).toBe('supabase');
    expect(ExtUser.refs.id.tableName).toBe('users');
  });

  it('brand survives .relations() chaining (F1)', () => {
    const ExtUser = new ContractModelBuilder(
      {
        modelName: 'User' as const,
        namespace: 'auth',
        fields: { id: field.column(int4Column).id() },
        relations: {},
      },
      undefined,
      undefined,
      'supabase' as const,
    )
      .relations({})
      .sql({ table: 'users' });
    expectTypeOf(ExtUser.refs.id).toEqualTypeOf<TargetFieldRef<'User', 'id', 'supabase'>>();
    expect(ExtUser.refs.id.spaceId).toBe('supabase');
    expect(ExtUser.refs.id.tableName).toBe('users');
  });
});

// ---------------------------------------------------------------------------
// Cross-space FK via constraints.foreignKey DSL
// ---------------------------------------------------------------------------

describe('cross-space FK via constraints.foreignKey in sql()', () => {
  it('accepts a cross-branded target in constraints.foreignKey and lowers spaceId', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, ExtUser.refs.id)],
    }));

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { supabase: supabasePack },
      models: { Profile },
    });

    const fks = unboundTables(contract.storage)['profile']?.foreignKeys;
    expect(fks).toHaveLength(1);
    expect(fks![0]!.target.spaceId).toBe('supabase');
    expect(fks![0]!.target.namespaceId).toBe('auth');
    expect(fks![0]!.target.tableName).toBe('users');
    expect(fks![0]!.target.columns).toEqual(['id']);
  });

  it('source side has no spaceId (local contract)', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, ExtUser.refs.id)],
    }));

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { supabase: supabasePack },
      models: { Profile },
    });

    const fks = unboundTables(contract.storage)['profile']?.foreignKeys;
    expect(fks![0]!.source).not.toHaveProperty('spaceId');
  });
});

// ---------------------------------------------------------------------------
// Missing-pack fail-fast (AC5 TS half)
// ---------------------------------------------------------------------------

/**
 * Synthetic supabase OrderItem handle whose `.sql()` stage is a factory
 * function, so the handle carries no statically readable table name.
 */
function buildSyntheticSupabaseOrderItem() {
  return new ContractModelBuilder(
    {
      modelName: 'OrderItem' as const,
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
        sku: field.column(textColumn),
      },
      relations: {},
    },
    undefined,
    undefined,
    'supabase' as const,
  ).sql(() => ({ table: 'order_items' }));
}

describe('cross-space FK to a handle with no statically readable table name', () => {
  const defineLineNoteContract = () => {
    const ExtOrderItem = buildSyntheticSupabaseOrderItem();

    const LineNote = model('LineNote', {
      fields: {
        id: field.column(int4Column).id(),
        orderItemId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'line_note',
      foreignKeys: [constraints.foreignKey(cols.orderItemId, ExtOrderItem.refs.id)],
    }));

    return defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { supabase: supabasePack },
      models: { LineNote },
    });
  };

  it('throws a structured error instead of guessing the target table', () => {
    expect(defineLineNoteContract).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FOREIGN_KEY_INVALID',
        message:
          'Foreign key on "LineNote" references model "OrderItem" in contract space "supabase" but the target table name is unknown: the handle\'s .sql() stage is a factory function, so its table cannot be read statically. Declare the target model\'s .sql() stage with a static object carrying `table`.',
      }),
    );
  });
});

describe('missing-pack fail-fast diagnostic', () => {
  it('throws when the referenced spaceId is not in extensions', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, ExtUser.refs.id)],
    }));

    expect(() =>
      defineContract({
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        // extensions intentionally omitted — 'supabase' is not declared
        models: { Profile },
      }),
    ).toThrow(/supabase/);

    expect(() =>
      defineContract({
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: { Profile },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.PACK_MISSING' }));
  });

  it('error message mentions extensions', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, ExtUser.refs.id)],
    }));

    expect(() =>
      defineContract({
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: { Profile },
      }),
    ).toThrow(/extensions/i);
  });
});

// ---------------------------------------------------------------------------
// Cascade permitted (AC4)
// ---------------------------------------------------------------------------

describe('cascade on cross-space FK (AC4)', () => {
  it('lowers onDelete:cascade without throwing', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, ExtUser.refs.id, { onDelete: 'cascade' })],
    }));

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { supabase: supabasePack },
      models: { Profile },
    });

    const fks = unboundTables(contract.storage)['profile']?.foreignKeys;
    expect(fks).toHaveLength(1);
    expect(fks![0]!.onDelete).toBe('cascade');
    expect(fks![0]!.target.spaceId).toBe('supabase');
  });
});

// ---------------------------------------------------------------------------
// NFR2 / AC9 regression — local FK must be byte-identical (no spaceId)
// ---------------------------------------------------------------------------

describe('local FK regression (NFR2 / AC9)', () => {
  it('a local FK has no spaceId on its target ForeignKeyReference', () => {
    const User = buildLocalUserModel();
    const Post = buildLocalPostModel(User);

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: { User, Post },
    });

    const fks = unboundTables(contract.storage)['post']?.foreignKeys;
    expect(fks).toHaveLength(1);
    // No spaceId key at all — JSON byte-identical to pre-cross-space contracts
    expect(fks![0]!.target).not.toHaveProperty('spaceId');
    expect(fks![0]!.target.namespaceId).toBe('public');
    expect(fks![0]!.target.tableName).toBe('user');
    expect(fks![0]!.target.columns).toEqual(['id']);
  });
});

// ---------------------------------------------------------------------------
// F-col — cross-space FK target columns use physical column name, not logical
// ---------------------------------------------------------------------------

describe('F-col: cross-space FK target columns prefer physical column name', () => {
  it('when the cross-space handle field uses .column("physical_id"), the FK target column is "physical_id" not "userId"', () => {
    // Extension model with a field whose physical column name differs from the logical field name.
    const ExtUser = new ContractModelBuilder(
      {
        modelName: 'User' as const,
        namespace: 'auth',
        fields: {
          // logical name: userId, physical column: physical_id
          userId: field.column(int4Column).column('physical_id').id(),
        },
        relations: {},
      },
      undefined,
      undefined,
      'supabase' as const,
    ).sql({ table: 'users' });

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        fkCol: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      // Reference the 'userId' field (logical name) on ExtUser — but FK should carry 'physical_id'
      foreignKeys: [constraints.foreignKey(cols.fkCol, ExtUser.refs.userId)],
    }));

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { supabase: supabasePack },
      models: { Profile },
    });

    const fks = unboundTables(contract.storage)['profile']?.foreignKeys;
    expect(fks).toHaveLength(1);
    // Target column must be the physical column name, not the logical field name
    expect(fks![0]!.target.columns).toEqual(['physical_id']);
  });
});

// ---------------------------------------------------------------------------
// F-compound — compound FK refs must all share the same cross-space coordinate
// ---------------------------------------------------------------------------

describe('F-compound: normalizeTargetFieldRefInput rejects mixed-space compound FK refs', () => {
  it('throws when compound FK refs mix different spaceId values', () => {
    // Two handles that have the same modelName but different spaceIds
    const ExtUserSpace1 = new ContractModelBuilder(
      {
        modelName: 'User' as const,
        namespace: 'auth',
        fields: {
          id: field.column(int4Column).id(),
          tenantId: field.column(int4Column),
        },
        relations: {},
      },
      undefined,
      undefined,
      'supabase' as const,
    ).sql({ table: 'users' });

    const ExtUserSpace2 = new ContractModelBuilder(
      {
        modelName: 'User' as const,
        namespace: 'auth',
        fields: {
          id: field.column(int4Column).id(),
          tenantId: field.column(int4Column),
        },
        relations: {},
      },
      undefined,
      undefined,
      // Different spaceId — same modelName as above
      'other_space' as const,
    ).sql({ table: 'users' });

    const otherPack: ExtensionPackRef<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'other_space',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
    };

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        fkId: field.column(int4Column),
        fkTenant: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      // Compound FK mixing refs from two different spaces — same modelName but different spaceId
      foreignKeys: [
        constraints.foreignKey(
          [cols.fkId, cols.fkTenant],
          [ExtUserSpace1.refs.id, ExtUserSpace2.refs.tenantId],
        ),
      ],
    }));

    expect(() =>
      defineContract({
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { supabase: supabasePack, other_space: otherPack },
        models: { Profile },
      }),
    ).toThrow(/spaceId/i);
  });
});
