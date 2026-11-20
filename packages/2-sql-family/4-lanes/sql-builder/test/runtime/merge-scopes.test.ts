import { describe, expect, it } from 'vitest';
import { mergeScopes, nullableScope } from '../../src/runtime/builder-base';
import type { ScopeField } from '../../src/scope';
import { usersScope } from './test-helpers';

const int4: ScopeField = { codecId: 'pg/int4@1', nullable: false };
const text: ScopeField = { codecId: 'pg/text@1', nullable: false };

const postsScope = {
  topLevel: { id: int4, title: text, user_id: int4 },
  namespaces: { posts: { id: int4, title: text, user_id: int4 } },
} as const;

const profilesScope = {
  topLevel: { id: int4, bio: text, user_id: int4 },
  namespaces: { profiles: { id: int4, bio: text, user_id: int4 } },
} as const;

describe('mergeScopes', () => {
  it('keeps a name at top level only when exactly one table has it', () => {
    const merged = mergeScopes(mergeScopes(usersScope, postsScope), profilesScope);

    expect(Object.keys(merged.topLevel).sort()).toEqual(['bio', 'email', 'name', 'title']);
    expect(Object.keys(merged.namespaces)).toEqual(['users', 'posts', 'profiles']);
    expect(merged.namespaces.profiles.id).toBe(int4);
  });

  it('drops a name the nullable side of an outer join shares with earlier tables', () => {
    const merged = mergeScopes(mergeScopes(usersScope, postsScope), nullableScope(profilesScope));

    expect(Object.keys(merged.topLevel).sort()).toEqual(['bio', 'email', 'name', 'title']);
    expect(merged.topLevel.bio).toEqual({ codecId: 'pg/text@1', nullable: true });
  });

  it('drops a name the joined table shares with a table merged earlier', () => {
    const merged = mergeScopes(usersScope, mergeScopes(postsScope, profilesScope));

    expect(Object.keys(merged.topLevel).sort()).toEqual(['bio', 'email', 'name', 'title']);
  });
});
