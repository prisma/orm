import { mkdir, rm, writeFile } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('db verify refuses a contract the family does not read', () => {
  it('names the contract file', async () => {
    const dir = createTestProjectDir('orm-db-verify-refused');
    dirs.push(dir);
    await mkdir(join(dir, 'output'), { recursive: true });
    const contractPath = join(dir, 'output', 'contract.json');
    await writeFile(contractPath, JSON.stringify({ formatVersion: 1, zzz: 1 }), 'utf-8');
    const config = {
      family: {
        kind: 'family',
        id: 'sql',
        familyId: 'sql',
        version: '1.0.0',
        emission: {},
        create: () => ({
          deserializeContract: () => {
            throw new ContractValidationError('zzz must be removed', 'structural');
          },
        }),
      },
      target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
      adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
      driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
      db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
      contract: {
        source: { format: 'typescript', inputs: [], load: async () => ({}) },
        output: 'output/contract.json',
      },
    };

    const run = await createOrmTestCli({
      commands: BIN_COMMANDS,
      groups: BIN_GROUPS,
      orm: config,
    }).run(['db', 'verify', '--json'], { cwd: dir });

    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONTRACT.VALIDATION_FAILED',
          why: `Contract at ${contractPath} failed to deserialize: zzz must be removed`,
        },
      },
    });
  });
});
