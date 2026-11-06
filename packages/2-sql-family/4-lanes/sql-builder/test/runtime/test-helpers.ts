import { ColumnRef, SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { ScopeField } from '../../src/scope';

const int4: ScopeField = { codecId: 'pg/int4@1', nullable: false, codec: { codecId: 'pg/int4@1' } };
const text: ScopeField = { codecId: 'pg/text@1', nullable: false, codec: { codecId: 'pg/text@1' } };

export const usersScope = {
  topLevel: { id: int4, name: text, email: text },
  namespaces: {
    users: { id: int4, name: text, email: text },
  },
} as const;

export const joinedScope = {
  topLevel: { name: text, title: text },
  namespaces: {
    users: { id: int4, name: text },
    posts: { id: int4, title: text, user_id: int4 },
  },
} as const;

export function makeSubquery(): { buildAst(): SelectAst } {
  const ast = SelectAst.from(TableSource.named('posts')).addProjection(
    'id',
    ColumnRef.of('posts', 'id'),
  );
  return { buildAst: () => ast };
}
