import type { TableIdentity } from '../../src/mutation-graph/nodes';

export const userTable: TableIdentity = {
  namespaceId: 'public',
  tableName: 'user',
  modelName: 'User',
  variantName: undefined,
};

export const postTable: TableIdentity = {
  namespaceId: 'public',
  tableName: 'post',
  modelName: 'Post',
  variantName: undefined,
};
