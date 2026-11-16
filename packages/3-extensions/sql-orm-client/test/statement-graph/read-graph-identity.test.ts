import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { readGraph } from '../../src/statement-graph/read-graph';
import type { CollectionState } from '../../src/types';
import { defineContract, field, model, rel } from '../contract-builder';
import {
  buildTestContextFromContract,
  createMockRuntime,
  perRelationPostgresAdapter,
} from '../helpers';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
  },
}).sql({ table: 'users' });

const Log = model('Log', {
  fields: {
    message: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
}).sql({ table: 'logs' });

const User = UserBase.relations({
  logs: rel.hasMany(() => Log, { by: 'userId' }),
}).sql({ table: 'users' });

const contract = defineContract({ models: { User, Log } });

const context = buildTestContextFromContract(contract, { adapter: perRelationPostgresAdapter });

function collectionOf<ModelName extends 'User' | 'Log'>(modelName: ModelName) {
  return new Collection({ runtime: createMockRuntime(), context }, modelName, {
    namespaceId: 'public',
  });
}

function readGraphOf(modelName: 'User' | 'Log', state: CollectionState) {
  return readGraph({ context, state, modelName, namespaceId: 'public' });
}

function refusal(meta: { model: string; table: string; include: string }) {
  return expect.objectContaining({
    code: 'ORM.ROW_IDENTITY_MISSING',
    message: `Cannot load include "${meta.include}" of model "${meta.model}": table "${meta.table}" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.`,
    meta,
  });
}

describe('a read with includes, one query per relation, from a table with no identity', () => {
  it('refuses an include of the top level', () => {
    const state = collectionOf('Log').include('author').state;

    expect(() => readGraphOf('Log', state)).toThrow(
      refusal({ model: 'Log', table: 'logs', include: 'author' }),
    );
  });

  it('refuses an include of a nested level', () => {
    const state = collectionOf('User').include('logs', (logs) => logs.include('author')).state;

    expect(() => readGraphOf('User', state)).toThrow(
      refusal({ model: 'Log', table: 'logs', include: 'author' }),
    );
  });

  it('reads an include limited to no rows, which needs no identity', () => {
    const state = collectionOf('Log').include('author', (author) => author.limit(0)).state;

    expect(() => readGraphOf('Log', state)).not.toThrow();
  });
});
