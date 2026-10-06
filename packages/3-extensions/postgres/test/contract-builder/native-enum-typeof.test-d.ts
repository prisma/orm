/**
 * TML-2960: `typeof contract` (the no-emit path) types a native-enum column
 * as its member-value literal union, matching what the emit path
 * (`generateContractDts`, proven in `native-enum.test.ts`) already produces.
 *
 * The mechanism: `PostgresNativeEnum` is generic over its `Members` tuple, so
 * `pg.enum(handle)`'s returned descriptor carries `entityRef.entity` typed as
 * `PostgresNativeEnum<Members>` instead of erasing it to `unknown`.
 * `ScalarFieldState` threads that full descriptor type (not just its
 * `codecId`), so the member tuple survives into the field's built state.
 * `FieldChannelType` reads a `DescriptorValueSetUnion` off that descriptor
 * (structurally, via `entityRef.entity.members`) exactly like it already
 * reads `EnumValueUnion` off an enum field's `typeRef`.
 */
import type {
  ExtractTypeMapsFromContract,
  FieldOutputTypesOf,
  StorageColumnTypesOf,
} from '@internal/sql-contract/types';
import type { DefaultModelRow } from '@internal/sql-orm-client';
import { expectTypeOf } from 'vitest';
import { defineContract, field, model, nativeEnum, pg } from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1' } as const;

const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

// Probe 0 — the handle itself captures the literals.
expectTypeOf(AalLevel.members).toEqualTypeOf<readonly ['aal1', 'aal2', 'aal3']>();

// Probe 1 — pg.enum(): the descriptor's entityRef.entity preserves the
// handle's PostgresNativeEnum<Members>, not `unknown`.
const columnDescriptor = pg.enum(AalLevel);
expectTypeOf(columnDescriptor.codecId).toEqualTypeOf<'pg/enum@1'>();
expectTypeOf(columnDescriptor.entityRef.entity.members).toEqualTypeOf<
  readonly ['aal1', 'aal2', 'aal3']
>();

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

type Maps = ExtractTypeMapsFromContract<typeof contract>;
type AalOutput = FieldOutputTypesOf<Maps>['public']['Session']['aal'];
type AalColumn = StorageColumnTypesOf<Maps>['public']['sessions']['aal'];

// Probe 2 — THE FIX: the no-emit field/column type is the member-value
// literal union (matching the emit path), not `string | null`.
expectTypeOf<AalOutput>().toEqualTypeOf<'aal1' | 'aal2' | 'aal3' | null>();
expectTypeOf<AalColumn>().toEqualTypeOf<'aal1' | 'aal2' | 'aal3' | null>();
expectTypeOf<AalOutput>().not.toEqualTypeOf<string | null>();
expectTypeOf<AalColumn>().not.toEqualTypeOf<string | null>();

// Probe 3 — storage plane of `typeof contract`: the mechanism does not rely
// on `BuiltStorage` carrying `valueSet`/`native_enum` entries — the union is
// read off the field's own descriptor, so `entries.table` remains the only
// entry kind.
type PublicEntries = (typeof contract)['storage']['namespaces']['public']['entries'];
expectTypeOf<keyof PublicEntries>().toEqualTypeOf<'table'>();

// Probe 4 — the built table column type: the native-enum column keeps its
// literal codecId.
type SessionsColumns = PublicEntries['table']['sessions']['columns'];
type AalStorageColumn = SessionsColumns['aal'];
expectTypeOf<AalStorageColumn['codecId']>().toEqualTypeOf<'pg/enum@1'>();

// Probe 5 — threading the full descriptor type through `ScalarFieldState`
// (Option A) keeps `intColumn`'s literal codec id in the built column type.
type IdStorageColumn = SessionsColumns['id'];
expectTypeOf<IdStorageColumn['codecId']>().toEqualTypeOf<'pg/int4@1'>();

// Probe 6 — the union reaches the ORM read surface on the no-emit path: a
// `DefaultModelRow` derived straight from `typeof contract` (no emit/`.d.ts`
// involved) narrows `Session.aal` to the member-value literal union.
type SessionRow = DefaultModelRow<typeof contract, 'Session'>;
expectTypeOf<SessionRow['aal']>().toEqualTypeOf<'aal1' | 'aal2' | 'aal3' | null>();
expectTypeOf<SessionRow['aal']>().not.toEqualTypeOf<string | null>();
