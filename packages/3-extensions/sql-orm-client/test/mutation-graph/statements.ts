import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { Graph, type ResultForm } from '../../src/mutation-graph/graph';
import { Delete, Find, Update } from '../../src/mutation-graph/nodes';
import { deleteAst, updateAst } from '../../src/query-plan-mutations';
import { collectionSelectAst } from '../../src/query-plan-select';
import { type CollectionState, emptyState } from '../../src/types';
import { getTestContext } from '../helpers';

const { contract } = getTestContext();

export const nameIsAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

export function findUsers(where: readonly AnyExpression[] = [], columns = ['id']): Find {
  return new Find(
    collectionSelectAst(contract, 'public', 'User', 'users', {
      ...emptyState(),
      filters: where,
      selectedFields: columns,
    }),
  );
}

export function updateUsers(set: Record<string, unknown>, where?: AnyExpression): Update {
  return new Update(updateAst(contract, 'public', 'users', set, where));
}

export function updatePosts(set: Record<string, unknown>, where?: AnyExpression): Update {
  return new Update(updateAst(contract, 'public', 'posts', set, where));
}

export function deleteUsers(where?: AnyExpression): Delete {
  return new Delete(deleteAst(contract, 'public', 'users', where));
}

export function deletePosts(where?: AnyExpression): Delete {
  return new Delete(deleteAst(contract, 'public', 'posts', where));
}

export function graphOfUsers(
  form: ResultForm = 'rows',
  state: Partial<CollectionState> = {},
): Graph {
  return new Graph(form, {
    context: getTestContext(),
    state: { ...emptyState(), ...state },
    tableName: 'users',
    modelName: 'User',
    namespaceId: 'public',
  });
}

export function graphOfPosts(form: ResultForm = 'rows'): Graph {
  return new Graph(form, {
    context: getTestContext(),
    state: emptyState(),
    tableName: 'posts',
    modelName: 'Post',
    namespaceId: 'public',
  });
}
