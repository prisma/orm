import { IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoValidator } from '../../src/ir/mongo-validator';

describe('MongoValidator', () => {
  it('extends IRNodeBase and freezes', () => {
    const v = new MongoValidator({
      jsonSchema: {},
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(v).toBeInstanceOf(IRNodeBase);
    expect(v).toBeInstanceOf(MongoValidator);
    expect(Object.isFrozen(v)).toBe(true);
    expect(() => {
      Object.assign(v, { validationLevel: 'moderate' });
    }).toThrow();
  });

  it('round-trips through canonical JSON with kind included', () => {
    const v = new MongoValidator({
      jsonSchema: { bsonType: 'object' },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      kind: 'mongo-validator',
      jsonSchema: { bsonType: 'object' },
      validationLevel: 'strict',
      validationAction: 'error',
    });
  });
});
