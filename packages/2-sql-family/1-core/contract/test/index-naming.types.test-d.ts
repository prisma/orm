import { expect, test } from 'vitest';
import type { AuthoredIndexInput } from '../src/index-naming';

const base = {
  columns: ['email'] as readonly string[],
  where: undefined,
  unique: undefined,
  map: undefined,
  name: undefined,
};

test('an options bag beside an explicit type is representable', () => {
  const authored: AuthoredIndexInput = { ...base, type: 'gin', options: { fastupdate: true } };
  expect(authored.options).toEqual({ fastupdate: true });
});

test('a type without options is representable', () => {
  const authored: AuthoredIndexInput = { ...base, type: 'hash', options: undefined };
  expect(authored.type).toBe('hash');
});

test('an options bag without a type is unrepresentable', () => {
  // @ts-expect-error — options only exist as options of a type
  const authored: AuthoredIndexInput = { ...base, type: undefined, options: { fastupdate: true } };
  expect(authored.options).toEqual({ fastupdate: true });
});
