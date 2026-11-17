import type { PostgresTsqueryArgument } from '@internal/target-postgres/full-text';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { contextWithTestMethods, notesContext } from './collection-methods-fixture';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

export class SearchableUserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((u) => u.name.eq(name));
  }

  relevant(query: PostgresTsqueryArgument) {
    return this.using.users_search(query);
  }
}

export function createCollectionMethodsOrm() {
  const runtime = createMockRuntime();
  const context = getTestContext();
  const db = orm({ runtime, context, collections: { User: SearchableUserCollection } });
  const plain = orm({ runtime, context });
  const notes = orm({ runtime, context: notesContext() });
  const extended = orm({ runtime, context: contextWithTestMethods() });
  return {
    runtime,
    db: db.public,
    plain: plain.public,
    notes: notes.public,
    extended: extended.public,
    fragment: plain.fragment,
  };
}
