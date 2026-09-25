import { computeExecutionHash } from '@internal/contract/hashing';
import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import {
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

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

const scaffold = { family: mongoFamilyPack, target: mongoTargetPack } as const;
const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

describe('Mongo TS temporal presets', () => {
  const contract = defineContract(scaffold, ({ field, model }) => ({
    models: {
      Post: model('Post', {
        collection: 'posts',
        fields: {
          _id: field.objectId(),
          updatedAt: field.temporal.updatedAt(),
          createdAt: field.temporal.createdAt(),
          touchedAt: field.temporal.timestamp(undefined, 'now'),
        },
      }),
    },
  }));

  it('types each preset field as a mongo/date@1 scalar', () => {
    const date = { nullable: false, type: { kind: 'scalar', codecId: 'mongo/date@1' } };
    expect(domainModelsAtDefaultNamespace(contract.domain)['Post']?.fields).toMatchObject({
      updatedAt: date,
      createdAt: date,
      touchedAt: date,
    });
  });

  it('emits sorted execution defaults keyed by collection and field name', () => {
    const mutations = {
      defaults: [
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'posts', field: 'createdAt' },
          onCreate: timestampNow,
        },
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'posts', field: 'touchedAt' },
          onUpdate: timestampNow,
        },
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'posts', field: 'updatedAt' },
          onCreate: timestampNow,
          onUpdate: timestampNow,
        },
      ],
    };
    expect(contract.execution).toEqual({
      executionHash: computeExecutionHash({
        target: 'mongo',
        targetFamily: 'mongo',
        execution: { mutations },
      }),
      mutations,
    });
  });

  it('omits the execution section when no field has execution defaults', () => {
    const plain = defineContract(scaffold, ({ field, model }) => ({
      models: {
        Post: model('Post', { collection: 'posts', fields: { _id: field.objectId() } }),
      },
    }));
    expect(plain).not.toHaveProperty('execution');
  });
});

describe('Mongo TS temporal preset misuse', () => {
  it('refuses a nullable field with execution defaults', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: { _id: field.objectId(), createdAt: field.temporal.createdAt().optional() },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: expect.objectContaining({
          modelName: 'Post',
          fieldName: 'createdAt',
          reason: 'nullable-with-executionDefaults',
        }),
      }),
    );
  });

  it('refuses a list field with execution defaults', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: { _id: field.objectId(), createdAt: field.temporal.createdAt().many() },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: expect.objectContaining({ reason: 'many-with-executionDefaults' }),
      }),
    );
  });

  it('refuses execution defaults on a model without a collection', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model }) => {
        const Owner = model('Owner', { collection: 'owners', fields: { _id: field.objectId() } });
        return {
          models: {
            Owner,
            Address: model('Address', {
              owner: Owner,
              fields: { createdAt: field.temporal.createdAt() },
            }),
          },
        };
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: expect.objectContaining({ reason: 'executionDefaults-without-collection' }),
      }),
    );
  });

  it('refuses execution defaults on a value-object field', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model, valueObject }) => ({
        valueObjects: {
          Audit: valueObject('Audit', { fields: { createdAt: field.temporal.createdAt() } }),
        },
        models: {
          Post: model('Post', { collection: 'posts', fields: { _id: field.objectId() } }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: expect.objectContaining({
          modelName: 'Audit',
          fieldName: 'createdAt',
          reason: 'executionDefaults-on-value-object',
        }),
      }),
    );
  });

  it('refuses a preset argument outside its option values', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: {
              _id: field.objectId(),
              touchedAt: field.temporal.timestamp('later' as 'now'),
            },
          }),
        },
      })),
    ).toThrow(/temporal\.timestamp/);
  });

  it('refuses a pack preset that collides with a core field helper', () => {
    const collidingTarget = {
      ...mongoTargetPack,
      authoring: { field: { string: temporalCodecPreset(mongoDate) } },
    } as const satisfies TargetPackRef<'mongo', 'mongo'>;
    expect(() =>
      defineContract({ family: mongoFamilyPack, target: collidingTarget }, () => ({ models: {} })),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' }));
  });

  it.each([
    ['default', { default: { kind: 'function', expression: 'now()' } }],
    ['id', { id: true }],
    ['unique', { unique: true }],
  ] as const)('refuses a pack preset that contributes %s', (contribution, output) => {
    const target = {
      ...mongoTargetPack,
      authoring: {
        field: { custom: { stamp: { kind: 'fieldPreset', output: { ...mongoDate, ...output } } } },
      },
    } as const satisfies TargetPackRef<'mongo', 'mongo'>;
    expect(() =>
      defineContract({ family: mongoFamilyPack, target }, ({ field, model }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: { _id: field.objectId(), stamp: field.custom.stamp() },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: expect.objectContaining({
          helperPath: 'custom.stamp',
          reason: 'preset-contribution-unsupported',
          contribution: [contribution],
        }),
      }),
    );
  });
});

describe('Mongo TS temporal presets on polymorphic models', () => {
  function eventContract(clickFields: 'plain' | 'withPreset') {
    return defineContract(scaffold, ({ field, model }) => {
      const Event = model('Event', {
        collection: 'events',
        fields: {
          _id: field.objectId(),
          kind: field.string(),
          createdAt: field.temporal.createdAt(),
        },
        discriminator: { field: 'kind', variants: { Click: { value: 'click' } } },
      });
      const Click = model('Click', {
        collection: 'events',
        base: Event,
        fields:
          clickFields === 'withPreset'
            ? { url: field.string(), clickedAt: field.temporal.createdAt() }
            : { url: field.string() },
      });
      return { models: { Event, Click } };
    });
  }

  it('emits one ref for a preset on the base model, shared by its variants', () => {
    expect(eventContract('plain').execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'events', field: 'createdAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('refuses execution defaults on a variant field', () => {
    expect(() => eventContract('withPreset')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: {
          modelName: 'Click',
          fieldName: 'clickedAt',
          reason: 'executionDefaults-on-variant',
        },
      }),
    );
  });
});

describe('Mongo TS temporal presets on models sharing a collection', () => {
  function sharedCollectionContract(pageStamp: 'createdAt' | 'updatedAt') {
    return defineContract(scaffold, ({ field, model }) => ({
      models: {
        Post: model('Post', {
          collection: 'entries',
          fields: { _id: field.objectId(), stamp: field.temporal.createdAt() },
        }),
        Page: model('Page', {
          collection: 'entries',
          fields: { _id: field.objectId(), stamp: field.temporal[pageStamp]() },
        }),
      },
    }));
  }

  it('merges identical execution defaults for the same collection field', () => {
    expect(sharedCollectionContract('createdAt').execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'entries', field: 'stamp' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('refuses differing execution defaults for the same collection field', () => {
    expect(() => sharedCollectionContract('updatedAt')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { modelName: 'Page', fieldName: 'stamp', reason: 'executionDefaults-conflict' },
      }),
    );
  });
});
