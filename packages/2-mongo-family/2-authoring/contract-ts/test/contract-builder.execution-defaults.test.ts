import { computeExecutionHash } from '@internal/contract/hashing';
import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import type { FieldBuilder } from '../src/contract-dsl';
import { mongoFamilyPack, mongoTargetPack as mongoTestTargetPack } from './mongo-test-packs';

/** What a JavaScript caller, whom the types do not stop, can write on a generated field. */
function untyped(builder: unknown): { many(): FieldBuilder } {
  return builder as { many(): FieldBuilder };
}

const mongoTargetPack = {
  ...mongoTestTargetPack,
  generatorFunctions: [
    {
      name: 'now',
      signature: { documentation: 'now' },
      bindings: [
        singleGeneratorBinding({ codecIds: ['mongo/date@1'], generatorId: 'timestampNow' }),
      ],
    },
  ],
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'timestampNow' }],
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const scaffold = { family: mongoFamilyPack, target: mongoTargetPack } as const;
const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

describe('Mongo TS generated fields', () => {
  const contract = defineContract(scaffold, ({ field, model, gen }) => ({
    models: {
      Post: model('Post', {
        collection: 'posts',
        fields: {
          _id: field.objectId(),
          updatedAt: field.date().onCreate(gen.now()).onUpdate(gen.now()),
          createdAt: field.date().onCreate(gen.now()),
          touchedAt: field.date().onUpdate(gen.now()),
        },
      }),
    },
  }));

  it('keys the execution default of a field by its stored name', () => {
    const mapped = defineContract(scaffold, ({ field, model, gen }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            id: field.objectId().mongo({ field: '_id' }),
            createdAt: field.date().onCreate(gen.now()).mongo({ field: 'created_at' }),
          },
        }),
      },
    }));
    expect(mapped.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'posts', field: 'created_at' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('types each generated field as a mongo/date@1 scalar', () => {
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

  it('hashes the execution section for the target the contract binds', () => {
    const otherTarget = {
      ...mongoTargetPack,
      id: 'mongo-other',
      targetId: 'mongo-other',
    } as const satisfies TargetPackRef<'mongo', 'mongo-other'>;
    const bound = defineContract(
      { family: mongoFamilyPack, target: otherTarget },
      ({ field, model, gen }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: { _id: field.objectId(), createdAt: field.date().onCreate(gen.now()) },
          }),
        },
      }),
    );
    expect(bound.target).toBe('mongo-other');
    expect(bound.execution?.executionHash).toBe(
      computeExecutionHash({
        target: 'mongo-other',
        targetFamily: 'mongo',
        execution: { mutations: { defaults: bound.execution?.mutations.defaults ?? [] } },
      }),
    );
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

describe('Mongo TS generated field misuse', () => {
  it('builds an optional field that generates a value', () => {
    const contract = defineContract(scaffold, ({ field, model, gen }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: { _id: field.objectId(), createdAt: field.date().onCreate(gen.now()).optional() },
        }),
      },
    }));

    expect({
      field: contract.domain.namespaces.__unbound__.models.Post.fields.createdAt,
      defaults: contract.execution?.mutations.defaults,
    }).toEqual({
      field: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: true, many: false },
      defaults: [
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'posts', field: 'createdAt' },
          onCreate: timestampNow,
        },
      ],
    });
  });

  it('refuses a list field with execution defaults', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model, gen }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: {
              _id: field.objectId(),
              createdAt: untyped(field.date().onCreate(gen.now())).many(),
            },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Post.createdAt" generates a value on write, so it cannot be a list; remove .many().',
        meta: expect.objectContaining({ reason: 'many-with-executionDefaults' }),
      }),
    );
  });

  it('refuses execution defaults on a model without a collection', () => {
    expect(() =>
      defineContract(scaffold, ({ field, model, gen }) => {
        const Owner = model('Owner', { collection: 'owners', fields: { _id: field.objectId() } });
        return {
          models: {
            Owner,
            Address: model('Address', {
              owner: Owner,
              fields: { createdAt: field.date().onCreate(gen.now()) },
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
      defineContract(scaffold, ({ field, model, valueObject, gen }) => ({
        valueObjects: {
          Audit: valueObject('Audit', { fields: { createdAt: field.date().onCreate(gen.now()) } }),
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
});

describe('Mongo TS generated fields on polymorphic models', () => {
  function eventContract(clickFields: 'plain' | 'withGenerated') {
    return defineContract(scaffold, ({ field, model, gen }) => {
      const Event = model('Event', {
        collection: 'events',
        fields: {
          _id: field.objectId(),
          kind: field.string(),
          createdAt: field.date().onCreate(gen.now()),
        },
        discriminator: { field: 'kind', variants: { Click: { value: 'click' } } },
      });
      const Click = model('Click', {
        collection: 'events',
        base: Event,
        fields:
          clickFields === 'withGenerated'
            ? { url: field.string(), clickedAt: field.date().onCreate(gen.now()) }
            : { url: field.string() },
      });
      return { models: { Event, Click } };
    });
  }

  it('emits one ref for a generated field on the base model, shared by its variants', () => {
    expect(eventContract('plain').execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'events', field: 'createdAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('refuses execution defaults on a variant field', () => {
    expect(() => eventContract('withGenerated')).toThrow(
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

describe('Mongo TS generated fields on models sharing a collection', () => {
  function sharedCollectionContract(pageStamp: 'createdAt' | 'updatedAt') {
    return defineContract(scaffold, ({ field, model, gen }) => ({
      models: {
        Post: model('Post', {
          collection: 'entries',
          fields: { _id: field.objectId(), stamp: field.date().onCreate(gen.now()) },
        }),
        Page: model('Page', {
          collection: 'entries',
          fields: {
            _id: field.objectId(),
            stamp:
              pageStamp === 'createdAt'
                ? field.date().onCreate(gen.now())
                : field.date().onCreate(gen.now()).onUpdate(gen.now()),
          },
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

  it("names each model's own field when differing defaults share a stored name", () => {
    expect(() =>
      defineContract(scaffold, ({ field, model, gen }) => ({
        models: {
          Post: model('Post', {
            collection: 'entries',
            fields: {
              _id: field.objectId(),
              createdAt: field.date().onCreate(gen.now()).mongo({ field: 'created_at' }),
            },
          }),
          Page: model('Page', {
            collection: 'entries',
            fields: {
              _id: field.objectId(),
              created: field
                .date()
                .onCreate(gen.now())
                .onUpdate(gen.now())
                .mongo({ field: 'created_at' }),
            },
          }),
        },
      })),
    ).toThrow(
      'Field "Page.created" has different executionDefaults than "Post.createdAt", which is stored in the same collection "entries". Use the same executionDefaults on both models.',
    );
  });
});
