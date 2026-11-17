import { expectTypeOf, test } from 'vitest';
import type { ControlMutationDefaultEntry } from '../src/shared/mutation-default-types';

test('a default function lowers to a database default only', () => {
  const databaseDefault: ControlMutationDefaultEntry['lower'] = () => ({
    ok: true,
    value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
  });
  const clientGenerator: ControlMutationDefaultEntry['lower'] = () => ({
    ok: true,
    // @ts-expect-error A client generator is a generator function, not a default function result.
    value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv4' } },
  });
  expectTypeOf(databaseDefault).toEqualTypeOf(clientGenerator);
});
