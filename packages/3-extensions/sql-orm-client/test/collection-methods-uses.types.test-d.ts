import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const q = websearchToTsquery('zebra');

export class SearchUsers extends Collection<TestContract, 'User'> {
  search() {
    return this.using.users_search(q);
  }
}

const context = getTestContext();
const runtime = createMockRuntime();
const db = orm({ runtime, context, collections: { User: SearchUsers } }).public;
const plain = orm({ runtime, context }).public;

export const use1 = plain.User.using.users_search(q);
export const use2 = db.User.using.users_search(q);
export const use3 = plain.User.where({ name: 'a' }).using.users_search(q);
export const use4 = plain.User.limit(3).using.users_search(q);
export const use5 = plain.User.select('id').using.users_search(q);
export const use6 = plain.User.include('invitedUsers', (invited) => invited.using.users_search(q));
export const use7 = SearchUsers;
export const use8 = plain.User.orderBy((u) => u.id.asc()).using.users_search(q);
export const use9 = plain.User.with((users) => users.using.users_search(q));
export const use10 = db.User.where({ name: 'a' }).using.users_search(q).search();

test('ten uses of a contributed method, one per site, type-check', () => {
  expectTypeOf(use1).not.toBeAny();
  expectTypeOf(use10).not.toBeAny();
});
