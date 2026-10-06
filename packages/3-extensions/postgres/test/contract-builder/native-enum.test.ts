/**
 * TML-2965 (native-enum-ts-authoring, D3): `nativeEnum(...)` + `pg.enum(handle)`
 * author a native Postgres enum column through `defineContract` (TS), byte-
 * shape-matching what the PSL `native_enum` + `pg.enum(Ref)` path produces
 * (see `psl-pg-enum-column.test.ts` in `@internal/target-postgres`):
 *
 *   1. The declared entity lands in `entries.native_enum` keyed by its PHYSICAL
 *      Postgres type name (ADR 221 coordinate `entityName`), while its derived
 *      value-set lands in `entries.valueSet` keyed by the entity NAME (the two
 *      keys differ when `.map()` is used), in both the default namespace
 *      (`public`) and a named schema (`auth`) — proving the deferred column
 *      descriptor's entity is harvested into the namespace's entries at build
 *      time.
 *   2. The column resolves to `{ codecId: 'pg/enum@1', nativeType,
 *      typeParams.typeName, valueSet ref }`, with `nativeType` from the mapped
 *      Postgres type name (schema-qualified for `auth`, bare for `public`) and
 *      `valueSet.entityName` from the entity name — proving qualification
 *      happens when the Postgres target builds the namespace
 *      (`postgresCreateNamespace`), not at `pg.enum()` call time, and that
 *      name/type-name stay distinct.
 *   3. No CHECK constraint is written (the native type itself enforces
 *      membership).
 *   4. `nativeEnum` rejects an empty or duplicate-valued member list.
 *   5. The emitted `.d.ts` types the column as the member-value literal
 *      union, proven through a real `generateContractDts` emission (not
 *      `typeof contract`).
 */

import { generateContractDts } from '@internal/emitter';
import type { CodecLookup } from '@internal/framework-components/codec';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { pgEnumDescriptor } from '@internal/target-postgres/codecs';
import type { PostgresSchema } from '@internal/target-postgres/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
  nativeEnum,
  pg,
} from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

function namespace(namespaces: Record<string, unknown>, id: string): PostgresSchema {
  const ns = namespaces[id] as PostgresSchema | undefined;
  if (ns === undefined) {
    throw new Error(`expected namespace "${id}" to be declared`);
  }
  return ns;
}

describe('nativeEnum + pg.enum (TS native-enum authoring)', () => {
  it('name === type name (no .map): entity keyed by type name (== name), bare column in public', () => {
    // Role has no `.map`, so entity name and Postgres type name are both `Role`
    // — the entity's physical-name entry key coincides with the handle here.
    const Role = nativeEnum('Role', 'user', 'admin');

    const contract = defineContract({
      models: {
        Account: model('Account', {
          fields: {
            id: field.column(intColumn).id(),
            role: field.column(pg.enum(Role)),
          },
        }).sql({ table: 'accounts' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'public');
    expect(ns.entries.native_enum?.['Role']).toEqual(Role.entity);
    expect(ns.valueSet?.['Role']).toEqual({ kind: 'valueSet', values: ['user', 'admin'] });

    const column = ns.table['accounts']?.columns['role'];
    expect(column).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'Role',
      typeParams: { typeName: 'Role' },
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'Role',
      },
    });
    expect(column?.typeRef).toBeUndefined();
    expect(ns.table['accounts']?.checks ?? []).toEqual([]);
  });

  it('name !== type name (.map): keys entries by physical type name, mapped type name in the column, in public', () => {
    // AalLevel maps to Postgres type `aal_level`: the entity entry keys by the
    // PHYSICAL type name (`aal_level`); the value-set stays keyed by the entity
    // NAME (`AalLevel`), and `nativeType` is the mapped type name.
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const contract = defineContract({
      models: {
        Session: model('Session', {
          fields: {
            id: field.column(intColumn).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'public');
    // Entity keyed by the mapped PHYSICAL type name, not the handle.
    expect(ns.entries.native_enum?.['aal_level']).toEqual(AalLevel.entity);
    expect(ns.entries.native_enum?.['AalLevel']).toBeUndefined();
    // The value-set stays keyed by the handle.
    expect(ns.valueSet?.['AalLevel']).toEqual({
      kind: 'valueSet',
      values: ['aal1', 'aal2', 'aal3'],
    });

    const column = ns.table['sessions']?.columns['aal'];
    expect(column).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'aal_level',
      typeParams: { typeName: 'aal_level' },
      nullable: true,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AalLevel',
      },
    });
    expect(column?.typeRef).toBeUndefined();
    expect(ns.table['sessions']?.checks ?? []).toEqual([]);
  });

  it('name !== type name (.map) in a named schema (auth): schema-qualifies the mapped type name, scopes to auth', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const contract = defineContract({
      namespaces: ['auth'],
      models: {
        Session: model('Session', {
          namespace: 'auth',
          fields: {
            id: field.column(intColumn).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'auth');
    expect(ns.entries.native_enum?.['aal_level']).toEqual(AalLevel.entity);
    expect(ns.valueSet?.['AalLevel']).toEqual({
      kind: 'valueSet',
      values: ['aal1', 'aal2', 'aal3'],
    });

    const column = ns.table['sessions']?.columns['aal'];
    expect(column).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'auth.aal_level',
      typeParams: { typeName: 'auth.aal_level' },
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'AalLevel',
      },
    });
    expect(ns.table['sessions']?.checks ?? []).toEqual([]);

    // The public namespace is untouched — the entity is scoped to `auth` only.
    const publicNs = namespace(contract.storage.namespaces, 'public');
    expect(publicNs.entries.native_enum?.['aal_level']).toBeUndefined();
  });

  it('rejects an empty member list', () => {
    // The `Members extends readonly [string, ...string[]]` constraint already
    // rejects this at compile time for typed callers; widen the signature to
    // prove the runtime guard also rejects a JS caller with no type checking.
    const untypedNativeEnum = nativeEnum as (name: string, ...members: string[]) => unknown;
    expect(() => untypedNativeEnum('EmptyEnum')).toThrow(/at least one member/);
  });

  it('rejects a duplicate member value', () => {
    expect(() => nativeEnum('DupEnum', 'a', 'b', 'a')).toThrow(/duplicate member value "a"/);
  });

  it('rejects an empty name', () => {
    expect(() => nativeEnum('', 'a')).toThrow(/name must be a non-empty string/);
    expect(() => nativeEnum('   ', 'a')).toThrow(/name must be a non-empty string/);
  });

  it('rejects an empty .map() type name', () => {
    expect(() => nativeEnum('X', 'a').map('')).toThrow(
      /Postgres type name must be a non-empty string/,
    );
  });

  it('rejects two DIFFERENT handles sharing a name, used by columns in the same namespace', () => {
    // Distinct entities (different member sets) sharing name `Status` — the
    // emitted valueSet could only reflect one, silently mismatching the other
    // column. PSL hard-errors on the equivalent; the TS path must too.
    const statusA = nativeEnum('Status', 'a', 'b');
    const statusB = nativeEnum('Status', 'x', 'y');

    expect(() =>
      defineContract({
        models: {
          Task: model('Task', {
            fields: {
              id: field.column(intColumn).id(),
              status: field.column(pg.enum(statusA)),
            },
          }).sql({ table: 'tasks' }),
          Job: model('Job', {
            fields: {
              id: field.column(intColumn).id(),
              status: field.column(pg.enum(statusB)),
            },
          }).sql({ table: 'jobs' }),
        },
      }),
    ).toThrow(/two different "native_enum" entities named "Status" in namespace "public"/);
  });

  it('rejects a native enum and an enumType() deriving a same-named value-set in one namespace', () => {
    // Both an `enumType()` (domain enum) and a `pg.enum(nativeEnum)` derive an
    // `entries.valueSet['Role']` in the default namespace. That slot drives
    // value-set → codec typing, so one silently overwriting the other would
    // corrupt a column. PSL hard-errors on the equivalent; the TS path must too.
    const RoleNative = nativeEnum('Role', 'user', 'admin');
    const RoleEnum = enumType('Role', pgText, member('User', 'user'));

    expect(() =>
      defineContract({
        enums: { Role: RoleEnum },
        models: {
          Account: model('Account', {
            fields: {
              id: field.column(intColumn).id(),
              role: field.column(pg.enum(RoleNative)),
              kind: field.namedType(RoleEnum),
            },
          }).sql({ table: 'accounts' }),
        },
      }),
    ).toThrow(
      /value-set "Role" in namespace "public" is derived from both an enum and a pack entity/,
    );
  });

  it('allows the SAME handle used by two columns in one namespace (one entity, one value-set)', () => {
    const Status = nativeEnum('Status', 'a', 'b');

    const contract = defineContract({
      models: {
        Task: model('Task', {
          fields: {
            id: field.column(intColumn).id(),
            status: field.column(pg.enum(Status)),
          },
        }).sql({ table: 'tasks' }),
        Job: model('Job', {
          fields: {
            id: field.column(intColumn).id(),
            status: field.column(pg.enum(Status)),
          },
        }).sql({ table: 'jobs' }),
      },
    });

    const ns = namespace(contract.storage.namespaces, 'public');
    expect(ns.entries.native_enum?.['Status']).toEqual(Status.entity);
    expect(ns.valueSet?.['Status']).toEqual({ kind: 'valueSet', values: ['a', 'b'] });
    expect(ns.table['tasks']?.columns['status']).toMatchObject({
      codecId: 'pg/enum@1',
      valueSet: { entityKind: 'valueSet', entityName: 'Status', namespaceId: 'public' },
    });
    expect(ns.table['jobs']?.columns['status']).toMatchObject({
      codecId: 'pg/enum@1',
      valueSet: { entityKind: 'valueSet', entityName: 'Status', namespaceId: 'public' },
    });
  });

  describe('emitted typing (via generateContractDts, not typeof contract)', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const contract = defineContract({
      models: {
        Session: model('Session', {
          fields: {
            id: field.column(intColumn).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    });

    const codecLookup: CodecLookup = {
      get: () => undefined,
      renderOutputTypeFor: () => undefined,
      renderValueLiteralFor: (id, value) =>
        id === 'pg/enum@1' ? pgEnumDescriptor.renderValueLiteral(value) : undefined,
    };

    function emit(): string {
      return generateContractDts(
        contract,
        sqlEmission,
        [],
        { storageHash: 'test-storage-hash', profileHash: 'test-profile-hash' },
        undefined,
        codecLookup,
      );
    }

    it('types the storage column and field output as the member-value literal union', () => {
      const dts = emit();

      const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
      expect(storageColumnMatch).not.toBeNull();
      expect(storageColumnMatch![0]).toContain('readonly aal: "aal1" | "aal2" | "aal3" | null');

      const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
      expect(fieldOutputMatch).not.toBeNull();
      expect(fieldOutputMatch![0]).toContain('readonly aal: "aal1" | "aal2" | "aal3" | null');
    });

    it("nativeEnum's handle preserves name, mapped type name, and the literal member tuple", () => {
      expectTypeOf(AalLevel.name).toEqualTypeOf<'AalLevel'>();
      expectTypeOf(AalLevel.typeName).toEqualTypeOf<'aal_level'>();
      expectTypeOf(AalLevel.members).toEqualTypeOf<readonly ['aal1', 'aal2', 'aal3']>();
    });
  });
});
