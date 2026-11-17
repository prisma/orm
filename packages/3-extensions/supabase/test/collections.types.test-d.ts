import { contractFromJson } from '@internal/postgres/static';
import { Collection } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import supabase, { type RoleBoundDb, type SupabaseDb } from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

class ProfileCollection extends Collection<Contract, 'Profile'> {
  named(username: string) {
    return this.where({ username });
  }
}

const contract = contractFromJson<Contract>(contractJson);
const jwtSecret = 'secret';
const db = await supabase({ contract, jwtSecret, collections: { Profile: ProfileCollection } });

test('a class method is typed on every role-bound client', async () => {
  expectTypeOf(db).toEqualTypeOf<SupabaseDb<Contract, { Profile: typeof ProfileCollection }>>();
  expectTypeOf(db.asAnon().orm.public.Profile.named).parameters.toEqualTypeOf<[username: string]>();
  expectTypeOf((await db.asUser('jwt')).orm.public.Profile.named).toBeFunction();
  expectTypeOf(db.asServiceRole().orm.public.Profile.named).toBeFunction();
  // @ts-expect-error the class has no such method
  db.asAnon().orm.public.Profile.missing();
});

test('a client with classes is accepted where a client without classes is expected', () => {
  const takesDb = (_db: SupabaseDb<Contract>) => undefined;
  const takesRoleBound = (_db: RoleBoundDb<Contract>) => undefined;
  takesDb(db);
  takesRoleBound(db.asAnon());
});

test('a client without classes has no class methods', async () => {
  const plain = await supabase({ contract, jwtSecret });
  expectTypeOf(plain).toEqualTypeOf<SupabaseDb<Contract>>();
  // @ts-expect-error no class is registered
  plain.asAnon().orm.public.Profile.named('ada');
});
