import { afterAll, beforeAll } from 'vitest';
import type { SqlContract } from '../../src/models/model-lookup';
import { createWorkDir, emitContract, type TargetName, targets, type WorkDir } from './databases';
import { pslHeader } from './printed-psl';

/** A work directory and an empty contract per database, for one test file. */
export interface ContractFixture {
  readonly workDir: WorkDir;
  emptyContract(target: TargetName): SqlContract;
  contractOf(target: TargetName, psl: string): Promise<SqlContract>;
}

export async function createContractFixture(): Promise<ContractFixture> {
  const workDir = await createWorkDir();
  const empty = new Map<TargetName, SqlContract>();
  for (const target of targets) {
    empty.set(target, (await emitContract(target, pslHeader, workDir)).contract);
  }
  return {
    workDir,
    emptyContract(target) {
      const contract = empty.get(target);
      if (contract === undefined) throw new Error(`No empty ${target} contract`);
      return contract;
    },
    async contractOf(target, psl) {
      return (await emitContract(target, psl, workDir)).contract;
    },
  };
}

/** Creates the fixture before the file's tests and removes its directory after them. */
export function useContractFixture(): () => ContractFixture {
  let fixture: ContractFixture | undefined;
  beforeAll(async () => {
    fixture = await createContractFixture();
  });
  afterAll(() => fixture?.workDir.remove());
  return () => {
    if (fixture === undefined) throw new Error('The contract fixture is created in beforeAll');
    return fixture;
  };
}
