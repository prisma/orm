import type { ExecutionMutationDefaultPhases } from '@internal/contract/types';
import {
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import { defineContract, type FieldBuilder } from '../src/contract-builder';
import type { EnumTypeHandle } from '../src/enum-type';

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

type TimestampNow = { readonly kind: 'generator'; readonly id: 'timestampNow' };
type DateField<Phases extends ExecutionMutationDefaultPhases | undefined> = FieldBuilder<
  { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' },
  false,
  false,
  EnumTypeHandle | undefined,
  Phases
>;

test('pack field presets appear on field with the codec their preset names', () => {
  defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field }) => {
    expectTypeOf(field.temporal.createdAt()).toEqualTypeOf<
      DateField<{ readonly onCreate: TimestampNow }>
    >();
    expectTypeOf(field.temporal.updatedAt()).toEqualTypeOf<
      DateField<{ readonly onCreate: TimestampNow; readonly onUpdate: TimestampNow }>
    >();
    expectTypeOf(field.temporal.timestamp()).toEqualTypeOf<DateField<Record<never, never>>>();
    expectTypeOf(field.temporal.timestamp(undefined, 'now')).toEqualTypeOf<
      DateField<{ readonly onCreate?: TimestampNow; readonly onUpdate?: TimestampNow }>
    >();
    expectTypeOf(field.temporal.timestamp('now', 'now')).toEqualTypeOf<
      DateField<{ readonly onCreate: TimestampNow; readonly onUpdate: TimestampNow }>
    >();
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

test('the built contract types its execution defaults with the collection and field names', () => {
  const contract = defineContract(
    { family: mongoFamilyPack, target: mongoTargetPack },
    ({ field, model }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            _id: field.objectId(),
            title: field.string(),
            createdAt: field.temporal.createdAt(),
            touchedAt: field.temporal.timestamp(undefined, 'now'),
          },
        }),
      },
    }),
  );
  type Defaults = NonNullable<(typeof contract)['execution']>['mutations']['defaults'][number];
  expectTypeOf<Defaults>().toEqualTypeOf<
    | {
        readonly ref: {
          readonly namespace: '__unbound__';
          readonly entry: 'posts';
          readonly field: 'createdAt';
        };
        readonly onCreate: TimestampNow;
      }
    | {
        readonly ref: {
          readonly namespace: '__unbound__';
          readonly entry: 'posts';
          readonly field: 'touchedAt';
        };
        readonly onCreate?: TimestampNow;
        readonly onUpdate?: TimestampNow;
      }
  >();
});
