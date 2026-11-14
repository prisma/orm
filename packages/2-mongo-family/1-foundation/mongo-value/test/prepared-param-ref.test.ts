import { describe, expect, it } from 'vitest';
import { isMongoPreparedParamRef, MongoParamRef, MongoPreparedParamRef } from '../src/exports';

describe('MongoPreparedParamRef', () => {
  it('holds a name, codec id and nullability and no value', () => {
    const ref = new MongoPreparedParamRef('email', 'mongo/string@1', true);
    expect({ ...ref }).toEqual({ name: 'email', codecId: 'mongo/string@1', nullable: true });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoPreparedParamRef('take', 'mongo/int32@1', false))).toBe(true);
  });
});

describe('isMongoPreparedParamRef', () => {
  it('recognises a placeholder', () => {
    expect(isMongoPreparedParamRef(new MongoPreparedParamRef('a', 'mongo/string@1', false))).toBe(
      true,
    );
  });

  it('rejects other values', () => {
    expect(
      [new MongoParamRef('a'), { name: 'a', codecId: 'mongo/string@1', nullable: false }, null].map(
        isMongoPreparedParamRef,
      ),
    ).toEqual([false, false, false]);
  });
});

describe('MongoParamRef', () => {
  it('carries nullable when given', () => {
    expect(new MongoParamRef(null, { codecId: 'mongo/string@1', nullable: true }).nullable).toBe(
      true,
    );
  });

  it('leaves nullable undefined by default', () => {
    expect(new MongoParamRef(1).nullable).toBeUndefined();
  });
});
