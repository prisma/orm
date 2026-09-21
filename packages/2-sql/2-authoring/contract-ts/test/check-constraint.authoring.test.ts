import { applySpecifierDefaultControlPolicy } from '@internal/contract/apply-specifier-default-control-policy';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { type Codec, emptyCodecLookup } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import {
  CheckConstraint,
  checkConstraintInputFromSerialized,
  type SqlStorage,
  SqlStorage as SqlStorageClass,
  type StorageTable,
  StorageTable as StorageTableClass,
} from '@internal/sql-contract/types';
import { validateStorage } from '@internal/sql-contract/validators';
import {
  computeCheckContentHash,
  formatWireName,
  parseNaming,
  WIRE_NAME_PREFIX_MAX_BYTES,
} from '@internal/sql-schema-ir/naming';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { check, defineContract } from '../src/contract-builder';
import { stripDerivedChecksFromNonManagedTables } from '../src/derived-checks';
import { enumType, member } from '../src/enum-type';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

interface RenderInput {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly memberValues: readonly (string | number)[] | undefined;
}

/**
 * Stands in for the Postgres pack's `renderCheckExpressions`, reproducing the
 * forms it emits. The real hook is unit-tested in the Postgres target package;
 * this file pins what the contract builder does with whatever a hook returns,
 * which is why the stub also records its calls.
 */
const hookCalls: RenderInput[] = [];

function renderCheckExpressions(input: RenderInput): ReadonlyArray<{
  readonly kind: 'membership' | 'elementNotNull';
  readonly columnName: string;
  readonly expression: string;
}> {
  hookCalls.push(input);
  const candidates: Array<{
    kind: 'membership' | 'elementNotNull';
    columnName: string;
    expression: string;
  }> = [];
  const column = `"${input.columnName}"`;
  if (input.memberValues !== undefined) {
    const members = input.memberValues
      .map((v) => (typeof v === 'number' ? String(v) : `'${v}'`))
      .join(', ');
    const arrayType = input.memberValues.every((v) => typeof v === 'number') ? 'numeric' : 'text';
    candidates.push({
      kind: 'membership',
      columnName: input.columnName,
      expression: input.many
        ? `${column}::${arrayType}[] <@ ARRAY[${members}]::${arrayType}[]`
        : `${column} IN (${members})`,
    });
  }
  if (input.many) {
    candidates.push({
      kind: 'elementNotNull',
      columnName: input.columnName,
      expression: `array_position(${column}, NULL) IS NULL`,
    });
  }
  return candidates;
}

// `AuthoringContributions` does not name the duck-typed hooks (the whole point
// of the pattern), so the pack carrying one is not written `satisfies
// TargetPackRef` — the real Postgres descriptor meta is not either.
const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  // `field: {}` is what makes this a real `AuthoringContributions` rather
  // than a weak-type mismatch; the production pack carries presets here.
  authoring: { field: {}, renderCheckExpressions },
} as const;

const bareTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;

const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Status = enumType('Status', pgText, member('Active', 'active'));

const nativeRoleDescriptor = {
  codecId: 'test/native-role@1',
  nativeType: 'native_role',
  valueSet: {
    plane: 'storage',
    entityKind: 'valueSet',
    namespaceId: 'public',
    entityName: 'NativeRole',
  },
} as const;

function checksOf(contract: Contract<SqlStorage>): readonly CheckConstraint[] {
  const ns = contract.storage.namespaces['public'];
  const table = ns !== undefined ? ns.entries.table?.['User'] : undefined;
  return (table as StorageTable | undefined)?.checks ?? [];
}

function flatten(checks: readonly CheckConstraint[]) {
  return checks.map((c) => ({ name: c.name, prefix: c.prefix, expression: c.expression }));
}

function wire(prefix: string, expression: string) {
  return { name: formatWireName(prefix, computeCheckContentHash(expression)), prefix, expression };
}

describe('check emission — scalar domain enum', () => {
  it('emits one wire-named membership check whose suffix hashes the expression', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: { User: m('User', { fields: { id: f.text().id(), role: f.namedType(Role) } }) },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([
      wire('User_role_check', `"role" IN ('user', 'admin')`),
    ]);
  });

  it('emits one check per enum-restricted column', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role, Status },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.namedType(Role), status: f.namedType(Status) },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract).map((c) => c.prefix)).toEqual([
      'User_role_check',
      'User_status_check',
    ]);
  });
});

describe('check emission — array domain enum', () => {
  it('emits the containment membership check plus the element-non-null check', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), roles: f.namedType(Role).many() } }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([
      wire('User_roles_check', `"roles"::text[] <@ ARRAY['user', 'admin']::text[]`),
      wire('User_roles_elem_not_null', `array_position("roles", NULL) IS NULL`),
    ]);
  });
});

describe('check emission — plain list column', () => {
  it('emits only the element-non-null check', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: { User: m('User', { fields: { id: f.text().id(), tags: f.text().many() } }) },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([
      wire('User_tags_elem_not_null', `array_position("tags", NULL) IS NULL`),
    ]);
  });
});

describe('check emission — entity-ref-resolved value set (native enum shape)', () => {
  it('emits no membership check for a scalar native-enum column', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.column(nativeRoleDescriptor) },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract)).toEqual([]);
  });

  it('emits only element-non-null for a native-enum array column', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), roles: f.column(nativeRoleDescriptor).many() },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([
      wire('User_roles_elem_not_null', `array_position("roles", NULL) IS NULL`),
    ]);
  });

  it('the hook sees no member values on the entity-ref path', () => {
    hookCalls.length = 0;
    defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.column(nativeRoleDescriptor) },
            }),
          },
        }) as const,
    );

    expect(hookCalls).toContainEqual({
      tableName: 'User',
      columnName: 'role',
      many: false,
      memberValues: undefined,
    });
  });
});

describe('check emission — domain enum on a non-pg codec', () => {
  it('still emits a membership check (a domain enum is always a plain scalar column)', () => {
    const NativeRole = enumType(
      'NativeRole',
      { codecId: 'test/native-enum@1', nativeType: 'native_role' },
      member('User', 'user'),
    );
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { NativeRole },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), role: f.namedType(NativeRole) } }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([wire('User_role_check', `"role" IN ('user')`)]);
  });
});

describe('check emission — a target with no hook writes no checks', () => {
  it('leaves checks absent even for an enum-restricted column', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: bareTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: { User: m('User', { fields: { id: f.text().id(), role: f.namedType(Role) } }) },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract)).toEqual([]);
  });
});

describe('check emission — guards', () => {
  // A check prefix is derived from the table and column names, so an author
  // has no way to shorten one — unlike an index, where `name:` is the escape
  // hatch the throw-stance assumes. Identity lives in the hash, so truncating
  // is safe: two prefixes that truncate alike still carry distinct hashes.
  it('truncates a derived prefix to the cap instead of throwing', () => {
    // `User_` + 44 + `_check` = 55 > 54.
    const longColumn = 'c'.repeat(44);
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), [longColumn]: f.namedType(Role) } }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const check = checksOf(contract)[0];
    // The cap is in UTF-8 bytes, so measure encoded bytes, not code units.
    expect(Buffer.byteLength(check?.prefix ?? '', 'utf8')).toBe(WIRE_NAME_PREFIX_MAX_BYTES);
    expect(`User_${longColumn}_check`.startsWith(check?.prefix ?? '')).toBe(true);
    // Postgres caps identifiers at 63 bytes; the wire name must fit.
    expect(Buffer.byteLength(check?.name ?? '', 'utf8')).toBeLessThanOrEqual(63);
  });

  it('the truncated prefix still round-trips through parseNaming', () => {
    const longColumn = 'c'.repeat(44);
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), [longColumn]: f.namedType(Role) } }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const check = checksOf(contract)[0];
    expect(parseNaming(check?.name ?? '', check?.prefix)).toEqual({
      kind: 'wire',
      prefix: check?.prefix,
      hash: check?.name.slice((check?.prefix?.length ?? 0) + 1),
    });
  });

  it('columns whose truncated prefixes collide still get distinct names', () => {
    // Both prefixes truncate to the same 54 characters — the columns differ
    // only past the cap. Same enum on both, so the member set is identical and
    // the ONLY thing separating the two predicates is the column name they
    // embed. That is precisely the property the truncation decision rests on.
    const shared = 'c'.repeat(50);
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                [`${shared}a`]: f.namedType(Role),
                [`${shared}b`]: f.namedType(Role),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const checks = checksOf(contract);
    expect(checks).toHaveLength(2);
    // Identical member sets: the predicates differ only by column name.
    expect(checks[0]?.expression).not.toBe(checks[1]?.expression);
    expect(checks[0]?.prefix).toBe(checks[1]?.prefix);
    expect(checks[0]?.name).not.toBe(checks[1]?.name);
  });

  it.each([true, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects unsupported membership value %s',
    (value) => {
      const Flag = enumType(
        'Flag',
        { codecId: 'pg/bool@1', nativeType: 'bool' },
        member('On', value),
      );
      expect(() =>
        defineContract(
          {
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
            enums: { Flag },
          },
          ({ field: f, model: m }) => ({
            models: { User: m('User', { fields: { id: f.text().id(), flag: f.namedType(Flag) } }) },
          }),
        ),
      ).toThrow(/CHECK constraint members must encode to strings or finite numbers/);
    },
  );

  it.each([
    { first: 1, second: 'two', many: false },
    { first: 'one', second: 2, many: false },
    { first: 1, second: 'two', many: true },
    { first: 'one', second: 2, many: true },
  ])(
    'rejects mixed members $first/$second with many=$many before rendering',
    ({ first, second, many }) => {
      const Mixed = enumType('Mixed', pgText, member('First', first), member('Second', second));
      hookCalls.length = 0;

      expect(() =>
        defineContract(
          {
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
            enums: { Mixed },
          },
          ({ field: f, model: m }) => ({
            models: {
              User: m('User', {
                fields: {
                  id: f.text().id(),
                  mixed: many ? f.namedType(Mixed).many() : f.namedType(Mixed),
                },
              }),
            },
          }),
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          meta: { enumName: 'Mixed', reason: 'mixed-member-types' },
        }),
      );
      expect(hookCalls).toEqual([
        { tableName: 'User', columnName: 'id', many: false, memberValues: undefined },
      ]);
    },
  );

  it.each([false, true])(
    'accepts mixed authored types normalized by a codec with many=%s',
    (many) => {
      const Normalized = enumType('Normalized', pgText, member('One', 1), member('Two', 'two'));
      const codec: Codec = {
        id: 'pg/text@1',
        encodeJson: ((value: unknown) => String(value)) as Codec['encodeJson'],
        decodeJson: (() => {
          throw new Error('unused');
        }) as Codec['decodeJson'],
        encode: (() => {
          throw new Error('unused');
        }) as Codec['encode'],
        decode: (() => {
          throw new Error('unused');
        }) as Codec['decode'],
      };
      hookCalls.length = 0;
      const contract = defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          enums: { Normalized },
          codecLookup: { ...emptyCodecLookup, get: (id) => (id === codec.id ? codec : undefined) },
        },
        ({ field: f, model: m }) => ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                normalized: many ? f.namedType(Normalized).many() : f.namedType(Normalized),
              },
            }),
          },
        }),
      ) as Contract<SqlStorage>;
      expect(hookCalls.at(-1)).toEqual({
        tableName: 'User',
        columnName: 'normalized',
        many,
        memberValues: ['1', 'two'],
      });
      expect(flatten(checksOf(contract))).toEqual(
        many
          ? [
              wire('User_normalized_check', `"normalized"::text[] <@ ARRAY['1', 'two']::text[]`),
              wire('User_normalized_elem_not_null', `array_position("normalized", NULL) IS NULL`),
            ]
          : [wire('User_normalized_check', `"normalized" IN ('1', 'two')`)],
      );
    },
  );

  it('passes numeric member values to the check renderer', () => {
    const Level = enumType('Level', { codecId: 'pg/int4@1', nativeType: 'int4' }, member('One', 1));
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Level },
      },
      ({ field: f, model: m }) => ({
        models: {
          User: m('User', { fields: { id: f.text().id(), level: f.namedType(Level) } }),
        },
      }),
    ) as Contract<SqlStorage>;
    expect(checksOf(contract)).toEqual([expect.objectContaining({ expression: '"level" IN (1)' })]);
    expect(hookCalls.at(-1)?.memberValues).toEqual([1]);
  });
});

describe('check emission — JSON round-trip', () => {
  it('hydrates checks back through the stored flat shape', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const json = JSON.parse(JSON.stringify(contract)) as {
      storage: {
        namespaces: Record<
          string,
          {
            entries: {
              table: Record<
                string,
                { checks: ReadonlyArray<{ name: string; prefix?: string; expression: string }> }
              >;
            };
          }
        >;
      };
    };
    const stored = json.storage.namespaces['public']?.entries.table['User']?.checks ?? [];
    const hydrated = stored.map(
      (flat) => new CheckConstraint(checkConstraintInputFromSerialized(flat)),
    );

    expect(flatten(hydrated)).toEqual(flatten(checksOf(contract)));
    expect(hydrated).toHaveLength(2);
  });
});

function columnOf(contract: Contract<SqlStorage>, columnName: string) {
  const ns = contract.storage.namespaces['public'];
  const table = ns !== undefined ? ns.entries.table?.['User'] : undefined;
  return (table as StorageTable | undefined)?.columns[columnName];
}

describe('noCheck — enforcement opt-out', () => {
  it('scalar domain enum + noCheck("membership") derives nothing and persists the flag', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.namedType(Role).noCheck('membership') },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract)).toEqual([]);
    const role = columnOf(contract, 'role');
    expect(role?.valueSet).toBeDefined();
    expect(role?.noCheck).toEqual(['membership']);
  });

  it('list domain enum + noCheck("membership") keeps exactly the elem_not_null check', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), roles: f.namedType(Role).many().noCheck('membership') },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([
      wire('User_roles_elem_not_null', `array_position("roles", NULL) IS NULL`),
    ]);
    expect(columnOf(contract, 'roles')?.noCheck).toEqual(['membership']);
  });

  it('list domain enum + bare noCheck() derives nothing and persists the canonical kind order', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), roles: f.namedType(Role).many().noCheck() },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract)).toEqual([]);
    expect(columnOf(contract, 'roles')?.noCheck).toEqual(['elementNotNull', 'membership']);
  });

  it('plain list + noCheck("elementNotNull") derives nothing', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), tags: f.text().many().noCheck('elementNotNull') },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract)).toEqual([]);
    expect(columnOf(contract, 'tags')?.noCheck).toEqual(['elementNotNull']);
  });
});

describe('noCheck — CONTRACT.CHECK_OPTOUT_INVALID', () => {
  it('rejects membership on a column with no domain-enum value set', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', {
                fields: { id: f.text().id(), name: f.text().noCheck('membership') },
              }),
            },
          }) as const,
      ),
    ).toThrow(/noCheck\("membership"\) does not apply/);
  });

  it('rejects elementNotNull on a non-many column', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          enums: { Role },
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', {
                fields: { id: f.text().id(), role: f.namedType(Role).noCheck('elementNotNull') },
              }),
            },
          }) as const,
      ),
    ).toThrow(/noCheck\("elementNotNull"\) does not apply/);
  });

  it('rejects bare noCheck() on a column that derives nothing', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), name: f.text().noCheck() } }),
            },
          }) as const,
      ),
    ).toThrow(/waives nothing/);
  });

  it('rejects duplicate kinds in one call', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          enums: { Role },
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', {
                fields: {
                  id: f.text().id(),
                  role: f.namedType(Role).noCheck('membership', 'membership'),
                },
              }),
            },
          }) as const,
      ),
    ).toThrow(/names the same kind twice/);
  });

  it('rejects calling noCheck() twice', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          enums: { Role },
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', {
                fields: {
                  id: f.text().id(),
                  role: f.namedType(Role).noCheck('membership').noCheck('membership'),
                },
              }),
            },
          }) as const,
      ),
    ).toThrow(/already called/);
  });
});

describe('noCheck — non-managed tables tolerate the flag', () => {
  it('a source-declared external table builds with a no-op flag', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), name: f.text().noCheck('membership') },
            }).sql({ control: 'external' }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(contract)).toEqual([]);
    expect(columnOf(contract, 'name')?.noCheck).toBeUndefined();
  });

  it('a specifier-stamped policy leaves the flag and the strip pass unaffected', () => {
    const built = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: {
                id: f.text().id(),
                role: f.namedType(Role),
                tags: f.text().many().noCheck('elementNotNull'),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(checksOf(built).map((c) => c.prefix)).toEqual(['User_role_check']);
    expect(columnOf(built, 'tags')?.noCheck).toEqual(['elementNotNull']);

    const stamped = applySpecifierDefaultControlPolicy(built, 'external');
    const stripped = stripDerivedChecksFromNonManagedTables(
      stamped,
      createTestSqlNamespace,
    ) as Contract<SqlStorage>;

    expect(checksOf(stripped)).toEqual([]);
    expect(columnOf(stripped, 'tags')?.noCheck).toEqual(['elementNotNull']);
  });
});

describe('noCheck — wire schema', () => {
  function rawStorageWith(noCheck: unknown): unknown {
    return {
      storageHash: 'test',
      namespaces: {
        public: {
          id: 'public',
          kind: 'test-sql-namespace',
          entries: {
            table: {
              User: {
                columns: {
                  tags: {
                    nativeType: 'text',
                    codecId: 'pg/text@1',
                    nullable: false,
                    many: true,
                    ...(noCheck !== undefined ? { noCheck } : {}),
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    };
  }

  it('an authored noCheck column round-trips: serialize → validate → hydrate → identical bytes', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), roles: f.namedType(Role).many().noCheck() },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const serialized = JSON.stringify(contract.storage);
    const parsed = JSON.parse(serialized) as unknown;
    validateStorage(parsed);

    const storedTable = (parsed as SqlStorage).namespaces['public']?.entries.table?.['User'] as
      | (Omit<StorageTable, 'checks'> & {
          readonly checks?: ReadonlyArray<{ name: string; prefix?: string; expression: string }>;
        })
      | undefined;
    expect(storedTable).toBeDefined();
    if (storedTable === undefined) return;

    const hydrated = new StorageTableClass({
      ...storedTable,
      checks: (storedTable.checks ?? []).map(checkConstraintInputFromSerialized),
    });
    expect(hydrated.columns['roles']?.noCheck).toEqual(['elementNotNull', 'membership']);

    const rehydrated = new StorageTableClass({
      ...(JSON.parse(JSON.stringify(hydrated)) as typeof storedTable),
      checks: [],
    });
    expect(JSON.stringify(rehydrated)).toBe(JSON.stringify(hydrated));
  });

  it.each([
    ['unsorted', ['membership', 'elementNotNull']],
    ['empty', []],
    ['duplicate', ['membership', 'membership']],
    ['unknown kind', ['bogus']],
  ])('rejects a %s noCheck array', (_label, noCheck) => {
    expect(() => validateStorage(rawStorageWith(noCheck))).toThrow();
  });
});

// Enforcement is derived only for tables Prisma 8 owns. The policy reaches
// the builder two ways — declared in the source, or stamped onto the finished
// contract by a contract specifier — so the rule is applied twice.
describe('check emission — derivation is scoped to managed tables', () => {
  function buildUser(options: {
    readonly control?: ControlPolicy;
    readonly defaultControlPolicy?: ControlPolicy;
  }): Contract<SqlStorage> {
    return defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
        ...ifDefined('defaultControlPolicy', options.defaultControlPolicy),
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
            }).sql(options.control === undefined ? {} : { control: options.control }),
          },
        }) as const,
    ) as Contract<SqlStorage>;
  }

  it('a managed table derives its checks', () => {
    expect(checksOf(buildUser({})).map((c) => c.prefix)).toEqual([
      'User_role_check',
      'User_tags_elem_not_null',
    ]);
  });

  it.each(['external', 'tolerated', 'observed'] as const)(
    'a table declared %s derives none',
    (control) => {
      expect(checksOf(buildUser({ control }))).toEqual([]);
    },
  );

  it('a contract-wide external default suppresses derivation', () => {
    expect(checksOf(buildUser({ defaultControlPolicy: 'external' }))).toEqual([]);
  });

  it('a managed table overriding an external default still derives', () => {
    expect(
      checksOf(buildUser({ control: 'managed', defaultControlPolicy: 'external' })),
    ).toHaveLength(2);
  });

  it('an external table overriding a managed default derives none', () => {
    expect(checksOf(buildUser({ control: 'external', defaultControlPolicy: 'managed' }))).toEqual(
      [],
    );
  });
});

// The Supabase shape: the pack's PSL declares no policy at all, and the
// contract specifier stamps `external` onto the finished contract. Emission has
// already run by then, so the strip is what carries the consequence.
describe('check emission — a specifier-applied policy strips derived checks', () => {
  function buildManagedUser(): Contract<SqlStorage> {
    return defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', {
              fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;
  }

  it('strips them and rehashes the storage', () => {
    const built = buildManagedUser();
    expect(checksOf(built)).toHaveLength(2);

    const stamped = applySpecifierDefaultControlPolicy(built, 'external');
    const stripped = stripDerivedChecksFromNonManagedTables(
      stamped,
      createTestSqlNamespace,
    ) as Contract<SqlStorage>;

    expect(checksOf(stripped)).toEqual([]);
    expect(stripped.storage.storageHash).not.toBe(built.storage.storageHash);
    expect(stripped.defaultControlPolicy).toBe('external');
  });

  it('leaves a managed contract untouched, by reference', () => {
    const built = buildManagedUser();
    expect(stripDerivedChecksFromNonManagedTables(built, createTestSqlNamespace)).toBe(built);
  });

  it('keeps an exact-named check and strips a wire-named one whose prefix matches a real column', () => {
    const built = buildManagedUser();
    const derived = '"tags" IS NOT NULL';
    const adopted = '"role" <> \'\'';
    const withAdopted: Contract<SqlStorage> = {
      ...built,
      defaultControlPolicy: 'external',
      storage: new SqlStorageClass({
        storageHash: built.storage.storageHash,
        namespaces: {
          public: createTestSqlNamespace({
            id: 'public',
            entries: {
              table: {
                User: new StorageTableClass({
                  columns: {
                    tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                  checks: [
                    { naming: { kind: 'exact', name: 'User_hand_written' }, expression: adopted },
                    {
                      naming: {
                        kind: 'wire',
                        prefix: 'User_tags_elem_not_null',
                        hash: computeCheckContentHash(derived),
                      },
                      expression: derived,
                    },
                  ],
                }),
              },
            },
          }),
        },
      }),
    };

    const stripped = stripDerivedChecksFromNonManagedTables(
      withAdopted,
      createTestSqlNamespace,
    ) as Contract<SqlStorage>;
    expect(flatten(checksOf(stripped))).toEqual([
      { name: 'User_hand_written', prefix: undefined, expression: adopted },
    ]);
  });

  // The regression test for the whole dispatch: slice 4 makes an authored
  // `name:` check wire-named too, so identifying "derived" by wire-naming
  // alone would delete an author's own constraint here. The prefix-shape
  // rule must tell the two apart using the table's real columns.
  it('keeps a wire-named check whose prefix matches no derived shape for the table', () => {
    const built = buildManagedUser();
    const authored = '"tags" IS NOT NULL AND "role" <> \'\'';
    const withAuthored: Contract<SqlStorage> = {
      ...built,
      defaultControlPolicy: 'external',
      storage: new SqlStorageClass({
        storageHash: built.storage.storageHash,
        namespaces: {
          public: createTestSqlNamespace({
            id: 'public',
            entries: {
              table: {
                User: new StorageTableClass({
                  columns: {
                    id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                    role: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                    tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                  checks: [
                    {
                      naming: {
                        kind: 'wire',
                        prefix: 'User_tags_and_role',
                        hash: computeCheckContentHash(authored),
                      },
                      expression: authored,
                    },
                  ],
                }),
              },
            },
          }),
        },
      }),
    };

    const stripped = stripDerivedChecksFromNonManagedTables(
      withAuthored,
      createTestSqlNamespace,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(stripped))).toEqual([wire('User_tags_and_role', authored)]);
    // Nothing was stripped, so the specifier funnel's reference-equality
    // contract holds all the way up to the returned contract.
    expect(stripped).toBe(withAuthored);
  });
});

describe('check() — Validation table', () => {
  it('rejects a check with neither name nor map', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [check({ expression: 'total > 0' })],
              }),
            },
          }) as const,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }));
  });

  it('rejects a check with both name and map', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [check({ expression: 'total > 0', name: 'a', map: 'b' })],
              }),
            },
          }) as const,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }));
  });

  it('rejects an empty expression', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [check({ expression: '', name: 'user_total_positive' })],
              }),
            },
          }) as const,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }));
  });

  it('rejects an authored name prefix over the wire-name byte budget', () => {
    const overBudget = 'a'.repeat(60);
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [check({ expression: 'total > 0', name: overBudget })],
              }),
            },
          }) as const,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.WIRE_NAME_PREFIX_TOO_LONG' }));
  });

  it('map: with a body mints the exact-name body warning, not an error', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const contract = defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [check({ expression: 'total > 0', map: 'legacy_total_check' })],
              }),
            },
          }) as const,
      ) as Contract<SqlStorage>;

      expect(flatten(checksOf(contract))).toEqual([
        { name: 'legacy_total_check', prefix: undefined, expression: 'total > 0' },
      ]);
      expect(emitWarning).toHaveBeenCalledTimes(1);
      expect(String(emitWarning.mock.calls[0]?.[0])).toContain(
        'check "legacy_total_check" uses map: with a SQL body.',
      );
    } finally {
      emitWarning.mockRestore();
    }
  });

  it('rejects two authored checks that collide on physical name — table-wide constraint-name uniqueness', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [
                  check({ expression: 'total > 0', map: 'dup' }),
                  check({ expression: 'total < 1000', map: 'dup' }),
                ],
              }),
            },
          }) as const,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED' }));
  });

  it('rejects an authored name whose prefix matches a derived-prefix shape for a real column', () => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), tags: f.text().many() } }).sql({
                checks: [check({ expression: 'true', name: 'User_tags_elem_not_null' })],
              }),
            },
          }) as const,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CHECK_NAME_RESERVED',
        message: expect.stringMatching(/column "tags" of this table/),
        meta: expect.objectContaining({ collidingColumns: ['tags'] }),
      }),
    );
  });
});

// An authored check must reach `table.checks` whatever the table's control
// policy. `derivesChecks` governs derivation only; it must not gate authored
// checks too.
describe('check() — authored checks are emitted regardless of control policy', () => {
  it('reaches table.checks on a managed table', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
              checks: [check({ expression: 'total > 0', name: 'user_total_positive' })],
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([wire('user_total_positive', 'total > 0')]);
  });

  it('reaches table.checks on an external (source-declared) table', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
              control: 'external',
              checks: [check({ expression: 'total > 0', name: 'user_total_positive' })],
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([wire('user_total_positive', 'total > 0')]);
  });

  it('an authored check on a specifier-stamped external table survives the strip that removes derived checks', () => {
    const built = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), role: f.namedType(Role) } }).sql({
              checks: [check({ expression: 'true', name: 'user_extra_rule' })],
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(
      checksOf(built)
        .map((c) => c.prefix)
        .sort(),
    ).toEqual(['User_role_check', 'user_extra_rule'].sort());

    const stamped = applySpecifierDefaultControlPolicy(built, 'external');
    const stripped = stripDerivedChecksFromNonManagedTables(
      stamped,
      createTestSqlNamespace,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(stripped))).toEqual([wire('user_extra_rule', 'true')]);
  });
});

describe('check() — coexists with derived checks on the same table', () => {
  it('keeps both, and both survive a JSON round-trip (canonical sort still holds)', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Role },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), role: f.namedType(Role) } }).sql({
              checks: [check({ expression: 'true', name: 'user_extra_rule' })],
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const built = [...flatten(checksOf(contract))].sort(byName);
    expect(built).toEqual(
      [
        wire('User_role_check', `"role" IN ('user', 'admin')`),
        wire('user_extra_rule', 'true'),
      ].sort(byName),
    );

    const json = JSON.parse(JSON.stringify(contract)) as {
      storage: {
        namespaces: Record<
          string,
          {
            entries: {
              table: Record<
                string,
                { checks: ReadonlyArray<{ name: string; prefix?: string; expression: string }> }
              >;
            };
          }
        >;
      };
    };
    const stored = json.storage.namespaces['public']?.entries.table['User']?.checks ?? [];
    expect(stored.map((c) => c.name).sort()).toEqual(built.map((c) => c.name).sort());
    expect(typeof contract.storage.storageHash).toBe('string');
  });
});

describe('check() — wire vs exact naming, through the built contract', () => {
  it('name: yields name_<8hex>, hashed over the expression', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
              checks: [check({ expression: 'total > 0', name: 'user_total_positive' })],
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    expect(flatten(checksOf(contract))).toEqual([wire('user_total_positive', 'total > 0')]);
  });

  it('map: yields the verbatim physical name with no suffix', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const contract = defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field: f, model: m }) =>
          ({
            models: {
              User: m('User', { fields: { id: f.text().id(), total: f.text() } }).sql({
                checks: [check({ expression: '(total > (0)::numeric)', map: 'positive_total' })],
              }),
            },
          }) as const,
      ) as Contract<SqlStorage>;

      expect(flatten(checksOf(contract))).toEqual([
        { name: 'positive_total', prefix: undefined, expression: '(total > (0)::numeric)' },
      ]);
    } finally {
      emitWarning.mockRestore();
    }
  });
});
