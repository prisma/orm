import {
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import { defineContract, type FieldBuilder } from '../src/contract-builder';

const mongoDate = { codecId: 'mongo/date@1', nativeType: 'date' } as const;

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  authoring: {
    field: {
      temporal: {
        ...temporalAuthoringPresets(mongoDate),
        timestamp: temporalCodecPreset(mongoDate),
      },
    },
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

type DateField = FieldBuilder<
  { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' },
  false,
  false
>;

test('pack field presets appear on field with the codec their preset names', () => {
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field }) => {
    expectTypeOf(field.temporal.createdAt()).toEqualTypeOf<DateField>();
    expectTypeOf(field.temporal.updatedAt()).toEqualTypeOf<DateField>();
    expectTypeOf(field.temporal.timestamp()).toEqualTypeOf<DateField>();
    expectTypeOf(field.temporal.timestamp('now', 'now')).toEqualTypeOf<DateField>();
    expectTypeOf(field.objectId).toBeFunction();
    return { models: {} };
  });
});

test('preset options accept only the values the preset lists', () => {
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field }) => {
    // @ts-expect-error 'later' is not an option value
    field.temporal.timestamp('later');
    // @ts-expect-error createdAt takes no arguments
    field.temporal.createdAt('now');
    return { models: {} };
  });
});
