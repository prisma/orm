/**
 * Acceptance: a Mongo enum document field types as the value union on BOTH the emitted
 * `contract.d.ts` path (`FieldOutputTypes` / ORM `DefaultModelRow`) AND the no-emit `typeof
 * contract` path (the domain enum's value union via `NamespacedEnums`), and the two agree — the
 * same shape SQL produces (`FieldOutputTypes[<ns>][<Model>][<field>]` narrows to the value union).
 *
 * The emit side consumes the real emitted `contract.d.ts` (emit-then-consume), not `typeof
 * contract`, so a divergence between authoring and emission is caught.
 */

import type { EnumValues, NamespacedEnums } from '@prisma/orm-mongo/contract/enum-accessor';
import type { DefaultModelRow } from '@prisma/orm-mongo/orm';
import { expectTypeOf, test } from 'vitest';
import type { Contract, FieldOutputTypes } from '../src/contract';

const ROLE_UNION = ['admin', 'author', 'reader'] as const;
type RoleUnion = (typeof ROLE_UNION)[number];

// Emit side: the emitted FieldOutputTypes narrows the enum field to the value union.
type EmittedRole = FieldOutputTypes['__unbound__']['User']['role'];

// Emit side (consumer): the ORM read row derives the same union from the emitted contract.
type OrmRole = DefaultModelRow<Contract, 'User'>['role'];

// No-emit side: the value union carried by the domain enum (`typeof contract`, via db.enums).
type NoEmitRoleValues = EnumValues<NamespacedEnums<Contract>['__unbound__']['UserRole']>;

test('emit: FieldOutputTypes types the enum field as the value union, not string', () => {
  expectTypeOf<EmittedRole>().toEqualTypeOf<RoleUnion>();
});

test('emit: the ORM read row narrows the enum field to the value union', () => {
  expectTypeOf<OrmRole>().toEqualTypeOf<RoleUnion>();
});

test('no-emit: the domain enum value union equals the same value union', () => {
  expectTypeOf<NoEmitRoleValues>().toEqualTypeOf<RoleUnion>();
});
