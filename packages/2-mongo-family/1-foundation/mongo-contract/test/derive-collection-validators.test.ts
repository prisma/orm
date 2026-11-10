import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  derive,
  embedMany,
  embedOne,
  jsonSchemas,
  type Model,
  model,
  objectId,
} from './collection-validator-helpers';
import { enumField, scalarField, voField } from './derive-json-schema-helpers';

const addressSchema = {
  bsonType: 'object',
  required: ['city'],
  properties: { city: { bsonType: 'string' } },
  additionalProperties: false,
};

describe('deriveCollectionValidators', () => {
  it('derives a closed validator for the root model of each collection', () => {
    const validators = derive({
      roots: { users: crossRef('User'), posts: crossRef('Post') },
      models: {
        User: model({ _id: objectId(), email: scalarField('mongo/string@1') }),
        Post: model({ _id: objectId() }),
      },
    });

    expect(jsonSchemas(validators)).toEqual({
      users: {
        bsonType: 'object',
        required: ['_id', 'email'],
        properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
        additionalProperties: false,
      },
      posts: {
        bsonType: 'object',
        required: ['_id'],
        properties: { _id: { bsonType: 'objectId' } },
        additionalProperties: false,
      },
    });
  });

  it('derives validators for root models only', () => {
    const validators = derive({
      roots: { users: crossRef('User') },
      models: {
        User: model({ _id: objectId() }),
        Address: model({ city: scalarField('mongo/string@1') }),
      },
    });

    expect(Object.keys(validators)).toEqual(['users']);
  });

  it('derives one polymorphic validator for a root model and its variants', () => {
    const validators = derive({
      roots: { tasks: crossRef('Task') },
      models: {
        Task: model(
          { _id: objectId(), type: scalarField('mongo/string@1') },
          { discriminator: { field: 'type' }, variants: { bug: crossRef('Bug') } },
        ),
        Bug: model({
          _id: objectId(),
          type: scalarField('mongo/string@1'),
          severity: scalarField('mongo/int32@1'),
        }),
      },
    });

    expect(jsonSchemas(validators)).toEqual({
      tasks: {
        bsonType: 'object',
        required: ['_id', 'type'],
        properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              type: { enum: ['bug'] },
              severity: { bsonType: 'int' },
            },
            required: ['severity', 'type'],
            additionalProperties: false,
          },
        ],
      },
    });
  });

  it('refuses a variant whose model is missing', () => {
    expect(() =>
      derive({
        roots: { tasks: crossRef('Task') },
        models: {
          Task: model(
            { _id: objectId(), type: scalarField('mongo/string@1') },
            { discriminator: { field: 'type' }, variants: { bug: crossRef('Bug') } },
          ),
        },
      }),
    ).toThrow('Variant model "Bug" of "Task" is missing');
  });

  it('describes value object fields as nested closed objects', () => {
    const validators = derive({
      roots: { users: crossRef('User') },
      models: { User: model({ _id: objectId(), address: voField('Address') }) },
      valueObjects: { Address: { fields: { city: scalarField('mongo/string@1') } } },
    });

    expect(jsonSchemas(validators)).toEqual({
      users: {
        bsonType: 'object',
        required: ['_id', 'address'],
        properties: {
          _id: { bsonType: 'objectId' },
          address: {
            bsonType: 'object',
            required: ['city'],
            properties: { city: { bsonType: 'string' } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    });
  });

  it('reads each value object from the storage namespace its field names', () => {
    const closedObject = (field: string) => ({
      bsonType: 'object',
      required: [field],
      properties: { [field]: { bsonType: 'string' } },
      additionalProperties: false,
    });
    const validators = derive({
      roots: { users: crossRef('User') },
      models: {
        User: model({
          _id: objectId(),
          home: voField('Address', false, 'home'),
          work: voField('Address', false, 'work'),
        }),
      },
      storage: {
        namespaces: {
          home: {
            id: 'home',
            entries: {
              valueObject: { Address: { fields: { city: scalarField('mongo/string@1') } } },
            },
          },
          work: {
            id: 'work',
            entries: {
              valueObject: { Address: { fields: { desk: scalarField('mongo/string@1') } } },
            },
          },
        },
      },
    });

    expect(jsonSchemas(validators)['users']?.['properties']).toEqual({
      _id: { bsonType: 'objectId' },
      home: closedObject('city'),
      work: closedObject('desk'),
    });
  });

  describe('embedded models', () => {
    const Address = model({ city: scalarField('mongo/string@1') });

    it('describes an embedded model as a nested closed object the document may omit', () => {
      const validators = derive({
        roots: { owners: crossRef('Owner') },
        models: {
          Owner: model({ _id: objectId() }, { relations: { home: embedOne('Address') } }),
          Address,
        },
      });

      expect(jsonSchemas(validators)).toEqual({
        owners: {
          bsonType: 'object',
          required: ['_id'],
          properties: { _id: { bsonType: 'objectId' }, home: addressSchema },
          additionalProperties: false,
        },
      });
    });

    it('describes a list of embedded models as an array of nested closed objects', () => {
      const validators = derive({
        roots: { owners: crossRef('Owner') },
        models: {
          Owner: model({ _id: objectId() }, { relations: { addresses: embedMany('Address') } }),
          Address,
        },
      });

      expect(jsonSchemas(validators)).toEqual({
        owners: {
          bsonType: 'object',
          required: ['_id'],
          properties: {
            _id: { bsonType: 'objectId' },
            addresses: { bsonType: 'array', items: addressSchema },
          },
          additionalProperties: false,
        },
      });
    });

    it('describes models embedded in an embedded model', () => {
      const validators = derive({
        roots: { owners: crossRef('Owner') },
        models: {
          Owner: model({ _id: objectId() }, { relations: { home: embedOne('Home') } }),
          Home: model({}, { relations: { address: embedOne('Address') } }),
          Address,
        },
      });

      expect(jsonSchemas(validators)['owners']).toMatchObject({
        properties: {
          home: {
            bsonType: 'object',
            properties: { address: addressSchema },
            additionalProperties: false,
          },
        },
      });
    });

    it('leaves reference relations out, since they are not stored in the document', () => {
      const validators = derive({
        roots: { owners: crossRef('Owner') },
        models: {
          Owner: model(
            { _id: objectId() },
            {
              relations: {
                posts: {
                  to: crossRef('Post'),
                  cardinality: '1:N',
                  on: { localFields: ['_id'], targetFields: ['ownerId'] },
                },
              },
            },
          ),
        },
      });

      expect(jsonSchemas(validators)['owners']).toEqual({
        bsonType: 'object',
        required: ['_id'],
        properties: { _id: { bsonType: 'objectId' } },
        additionalProperties: false,
      });
    });

    it('adds the embedded models of a variant to its branch', () => {
      const validators = derive({
        roots: { tasks: crossRef('Task') },
        models: {
          Task: model(
            { _id: objectId(), type: scalarField('mongo/string@1') },
            { discriminator: { field: 'type' }, variants: { visit: crossRef('Visit') } },
          ),
          Visit: model(
            { _id: objectId(), type: scalarField('mongo/string@1') },
            { relations: { place: embedOne('Address') } },
          ),
          Address,
        },
      });

      expect(jsonSchemas(validators)['tasks']).toMatchObject({
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              type: { enum: ['visit'] },
              place: addressSchema,
            },
            required: ['type'],
            additionalProperties: false,
          },
        ],
      });
    });

    it('derives a deep chain of embedded models without a cycle', () => {
      const depth = 50;
      const models: Record<string, Model> = {
        Root: model({ _id: objectId() }, { relations: { next: embedOne('Level0') } }),
      };
      for (let level = 0; level < depth; level++) {
        models[`Level${level}`] = model(
          { name: scalarField('mongo/string@1') },
          level + 1 < depth ? { relations: { next: embedOne(`Level${level + 1}`) } } : {},
        );
      }

      const validators = derive({ roots: { roots: crossRef('Root') }, models });

      let schema: unknown = validators['roots']?.jsonSchema;
      let levels = 0;
      while (
        typeof schema === 'object' &&
        schema !== null &&
        'properties' in schema &&
        typeof schema.properties === 'object' &&
        schema.properties !== null &&
        'next' in schema.properties
      ) {
        schema = schema.properties.next;
        levels++;
      }
      expect(levels).toBe(depth);
    });

    it('describes the same embedded model in two places', () => {
      const validators = derive({
        roots: { owners: crossRef('Owner') },
        models: {
          Owner: model(
            { _id: objectId() },
            { relations: { home: embedOne('Address'), work: embedOne('Address') } },
          ),
          Address,
        },
      });

      expect(jsonSchemas(validators)['owners']).toMatchObject({
        properties: { home: addressSchema, work: addressSchema },
      });
    });

    it('refuses an embedded model that is missing', () => {
      expect(() =>
        derive({
          roots: { owners: crossRef('Owner') },
          models: {
            Owner: model({ _id: objectId() }, { relations: { home: embedOne('Address') } }),
          },
        }),
      ).toThrow('Embedded model "Address" is missing');
    });
  });

  it('lists the stored values of an enum field', () => {
    const validators = derive({
      roots: { users: crossRef('User') },
      models: { User: model({ _id: objectId(), role: enumField('mongo/string@1', 'Role') }) },
      valueSets: { Role: { values: ['user', 'admin'] } },
    });

    expect(jsonSchemas(validators)).toEqual({
      users: {
        bsonType: 'object',
        required: ['_id', 'role'],
        properties: {
          _id: { bsonType: 'objectId' },
          role: { bsonType: 'string', enum: ['user', 'admin'] },
        },
        additionalProperties: false,
      },
    });
  });
});

describe('deriveCollectionValidators for a collection that stores several root models', () => {
  const userSchema = {
    bsonType: 'object',
    required: ['_id', 'email'],
    properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
    additionalProperties: false,
  };

  it('accepts a document of any root model, one anyOf branch per model in name order', () => {
    const validators = derive({
      roots: { users: crossRef('User') },
      models: {
        User: model(
          { _id: objectId(), email: scalarField('mongo/string@1') },
          { storage: { collection: 'users' } },
        ),
        Admin: model(
          { _id: objectId(), level: scalarField('mongo/int32@1') },
          { storage: { collection: 'users' } },
        ),
      },
    });

    expect(jsonSchemas(validators)).toEqual({
      users: {
        bsonType: 'object',
        anyOf: [
          {
            bsonType: 'object',
            required: ['_id', 'level'],
            properties: { _id: { bsonType: 'objectId' }, level: { bsonType: 'int' } },
            additionalProperties: false,
          },
          userSchema,
        ],
      },
    });
  });

  it('gives a root model with variants its own oneOf inside its branch', () => {
    const validators = derive({
      roots: { users: crossRef('User') },
      models: {
        User: model(
          { _id: objectId(), email: scalarField('mongo/string@1') },
          { storage: { collection: 'users' } },
        ),
        Task: model(
          { _id: objectId(), type: scalarField('mongo/string@1') },
          {
            storage: { collection: 'users' },
            discriminator: { field: 'type' },
            variants: { bug: crossRef('Bug') },
          },
        ),
        Bug: model(
          { severity: scalarField('mongo/int32@1') },
          { storage: { collection: 'users' }, base: crossRef('Task') },
        ),
        Note: model({ text: scalarField('mongo/string@1') }, { owner: 'User' }),
      },
    });

    expect(jsonSchemas(validators)).toEqual({
      users: {
        bsonType: 'object',
        anyOf: [
          {
            bsonType: 'object',
            required: ['_id', 'type'],
            properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
            oneOf: [
              {
                properties: {
                  _id: { bsonType: 'objectId' },
                  type: { enum: ['bug'] },
                  severity: { bsonType: 'int' },
                },
                required: ['severity', 'type'],
                additionalProperties: false,
              },
            ],
          },
          userSchema,
        ],
      },
    });
  });
});

describe('deriveCollectionValidators and the document id', () => {
  it('requires an objectId _id in a root model that declares none', () => {
    const validators = derive({
      roots: { notes: crossRef('Note') },
      models: { Note: model({ text: scalarField('mongo/string@1') }) },
    });

    expect(jsonSchemas(validators)).toEqual({
      notes: {
        bsonType: 'object',
        required: ['_id', 'text'],
        properties: { _id: { bsonType: 'objectId' }, text: { bsonType: 'string' } },
        additionalProperties: false,
      },
    });
  });

  it('requires an objectId _id in every branch of a shared collection and at the top of a model with variants', () => {
    const validators = derive({
      roots: { items: crossRef('Note') },
      models: {
        Note: model({ text: scalarField('mongo/string@1') }, { storage: { collection: 'items' } }),
        Task: model(
          { type: scalarField('mongo/string@1') },
          {
            storage: { collection: 'items' },
            discriminator: { field: 'type' },
            variants: { bug: crossRef('Bug') },
          },
        ),
        Bug: model(
          { severity: scalarField('mongo/int32@1') },
          { storage: { collection: 'items' }, base: crossRef('Task') },
        ),
      },
    });

    expect(jsonSchemas(validators)).toEqual({
      items: {
        bsonType: 'object',
        anyOf: [
          {
            bsonType: 'object',
            required: ['_id', 'text'],
            properties: { _id: { bsonType: 'objectId' }, text: { bsonType: 'string' } },
            additionalProperties: false,
          },
          {
            bsonType: 'object',
            required: ['_id', 'type'],
            properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
            oneOf: [
              {
                properties: {
                  _id: { bsonType: 'objectId' },
                  type: { enum: ['bug'] },
                  severity: { bsonType: 'int' },
                },
                required: ['severity', 'type'],
                additionalProperties: false,
              },
            ],
          },
        ],
      },
    });
  });

  describe('under a control policy', () => {
    const roots = {
      managed: crossRef('Managed'),
      tolerated: crossRef('Tolerated'),
      external: crossRef('External'),
      observed: crossRef('Observed'),
    };
    const models = {
      Managed: model({ _id: objectId() }),
      Tolerated: model({ _id: objectId() }),
      External: model({ _id: objectId() }),
      Observed: model({ _id: objectId() }),
    };

    it('derives a validator only for a managed collection', () => {
      const validators = derive({
        roots,
        models,
        controlPolicies: {
          collections: {
            managed: 'managed',
            tolerated: 'tolerated',
            external: 'external',
            observed: 'observed',
          },
          defaultControlPolicy: undefined,
        },
      });

      expect(Object.keys(validators)).toEqual(['managed']);
    });

    it('takes the contract default for a collection without its own policy', () => {
      const validators = derive({
        roots,
        models,
        controlPolicies: { collections: { managed: 'managed' }, defaultControlPolicy: 'observed' },
      });

      expect(Object.keys(validators)).toEqual(['managed']);
    });

    it('derives none under an external default, even for a collection declared managed', () => {
      const validators = derive({
        roots,
        models,
        controlPolicies: { collections: { managed: 'managed' }, defaultControlPolicy: 'external' },
      });

      expect(validators).toEqual({});
    });
  });
});
