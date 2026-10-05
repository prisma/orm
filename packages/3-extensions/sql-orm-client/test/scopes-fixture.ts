import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import type { Contract } from './fixtures/soft-delete/generated/contract';
import contractJson from './fixtures/soft-delete/generated/contract.json' with { type: 'json' };
import { buildTestContextFromContract, createMockRuntime } from './helpers';

export type SoftDeleteContract = Contract;

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);
const context = buildTestContextFromContract(contract);

export class SoftPostCollection extends Collection<Contract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gte(100));
  }
}

export function createScopesOrm() {
  const runtime = createMockRuntime();
  const db = orm({ runtime, context, collections: { Post: SoftPostCollection } });
  const plain = orm({ runtime, context });
  return { runtime, client: db, db: db.public, plain: plain.public };
}
