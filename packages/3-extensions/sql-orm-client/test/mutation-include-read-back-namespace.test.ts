import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  BinaryExpr,
  ListExpression,
  ParamRef,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { reloadMutationRowsByIdentities } from '../src/collection-dispatch';
import { buildTestContextFromContract, createMockRuntime, type MockRuntime } from './helpers';

const DATA_TYPE_OF_CODEC: Readonly<Record<string, string>> = {
  'pg/int4@1': 'pg/int4',
  'pg/text@1': 'pg/text',
};

function dataTypeOf(codecId: string): string {
  const dataType = DATA_TYPE_OF_CODEC[codecId];
  if (dataType === undefined) throw new Error(`no data type listed for codec ${codecId}`);
  return dataType;
}

function storageTable(columnCodecs: Record<string, string>) {
  const cols: Record<string, { codecId: string; dataType: string; nullable: boolean }> = {};
  for (const [column, codecId] of Object.entries(columnCodecs)) {
    cols[column] = { codecId, dataType: dataTypeOf(codecId), nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

function model() {
  return {
    fields: {},
    relations: {},
    storage: { table: 'users', fields: { id: { column: 'id' } } },
  };
}

// `User` lives in BOTH namespaces, each backed by a table with the SAME bare
// name `users`, but the PK column `id` carries a DIFFERENT codec per namespace
// (`pg/int4@1` in `public`, `pg/text@1` in `auth`). The mutation-with-include
// read-back keys its `id IN (...)` filter on this PK column, so the param it
// stamps must discriminate by the namespace coordinate — first-matching the
// wrong namespace would stamp the wrong codec (or, since the bare name is
// ambiguous, throw outright).
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: { returning: { enabled: true } },
  domain: {
    namespaces: {
      public: { models: { User: model() } },
      auth: { models: { User: model() } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: { table: { users: storageTable({ id: 'pg/int4@1' }) } },
      },
      auth: {
        id: 'auth',
        entries: { table: { users: storageTable({ id: 'pg/text@1' }) } },
      },
    },
  },
});
const twoNamespaceContext = buildTestContextFromContract(twoNamespaceContract);

async function readBackIdentityCodec(
  runtime: MockRuntime,
  namespaceId: string,
  identityValue: unknown,
): Promise<{ codecId: string } | undefined> {
  runtime.setNextResults([[]]);
  await reloadMutationRowsByIdentities<Record<string, unknown>>({
    context: twoNamespaceContext,
    runtime,
    tableName: 'users',
    modelName: 'User',
    namespaceId,
    identityRows: [{ id: identityValue }],
    selectedFields: ['id'],
    includes: [],
  }).toArray();

  const plan = runtime.executions[runtime.executions.length - 1]?.plan;
  const ast = (plan as { ast: SelectAst }).ast;
  const where = ast.where as BinaryExpr;
  const list = where.right as ListExpression;
  const param = list.values[0] as ParamRef;
  return param.codec;
}

describe('mutation-with-include read-back namespace coordinate', () => {
  it('stamps the public-namespace PK codec on the identity-filter param', async () => {
    const runtime = createMockRuntime();
    const codec = await readBackIdentityCodec(runtime, 'public', 1);
    expect(codec).toEqual({ codecId: 'pg/int4@1' });
  });

  it('stamps the auth-namespace PK codec on the identity-filter param', async () => {
    const runtime = createMockRuntime();
    const codec = await readBackIdentityCodec(runtime, 'auth', 'u1');
    expect(codec).toEqual({ codecId: 'pg/text@1' });
  });
});
