import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext } from './helpers';

const db = orm({ runtime: createMockRuntime(), context: getTestContext() });

test('the namespace facet exposes its models', () => {
  expectTypeOf(db.public).toHaveProperty('User');
  expectTypeOf(db.public).toHaveProperty('Post');
});

test('an undeclared namespace id is not a key on the typed surface', () => {
  // @ts-expect-error 'auth' is not a declared domain namespace of this contract
  db.auth;
});
