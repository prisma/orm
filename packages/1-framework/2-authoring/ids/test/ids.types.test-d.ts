import { expectTypeOf, test } from 'vitest';
import * as ids from '../src/index';

test('the package has no spec helpers that bundle a column type with a generator', () => {
  expectTypeOf(ids).not.toHaveProperty('uuidv4');
  expectTypeOf(ids).not.toHaveProperty('uuidv7');
  expectTypeOf(ids).not.toHaveProperty('ulid');
  expectTypeOf(ids).not.toHaveProperty('nanoid');
  expectTypeOf(ids).not.toHaveProperty('cuid2');
  expectTypeOf(ids).not.toHaveProperty('ksuid');
});
