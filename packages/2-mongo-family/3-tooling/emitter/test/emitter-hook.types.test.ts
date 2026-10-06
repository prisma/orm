import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

describe('mongoEmission.validateTypes', () => {
  it('passes with valid codec IDs', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
            name: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'users' },
        },
      },
    });
    expect(() => mongoEmission.validateTypes(contract, {})).not.toThrow();
  });

  it('passes with no models', () => {
    const contract = createMongoContract({ models: {} });
    expect(() => mongoEmission.validateTypes(contract, {})).not.toThrow();
  });

  it('throws for missing codecId', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            name: { nullable: false, many: false, type: { kind: 'scalar', codecId: '' } },
          },
          relations: {},
          storage: {},
        },
      },
    });
    expect(() => mongoEmission.validateTypes(contract, {})).toThrow('missing codecId');
  });

  it('throws for invalid codec ID format', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            name: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'invalid-format' },
            },
          },
          relations: {},
          storage: {},
        },
      },
    });
    expect(() => mongoEmission.validateTypes(contract, {})).toThrow('invalid codec ID format');
  });
});
