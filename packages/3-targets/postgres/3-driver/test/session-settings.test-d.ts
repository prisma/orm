import { expectTypeOf, test } from 'vitest';
import { createPgClient, createPgPool, pgConnectionConfig } from '../src/session-settings';

test('a pg pool, client or connection config cannot be made without the session settings', () => {
  // @ts-expect-error the session settings the target declares are required
  createPgPool({ connectionString: 'postgres://db.example.com/app' });
  // @ts-expect-error the session settings the target declares are required
  createPgClient({ connectionString: 'postgres://db.example.com/app' });
  // @ts-expect-error the session settings the target declares are required
  pgConnectionConfig({ connectionString: 'postgres://db.example.com/app' });
  expectTypeOf(createPgPool).parameter(1).toEqualTypeOf<Readonly<Record<string, string>>>();
});
