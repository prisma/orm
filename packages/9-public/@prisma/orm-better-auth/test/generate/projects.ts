import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BetterAuthOptions } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { join } from 'pathe';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import type { PrismaClientLike } from '../../src/adapter';
import { prismaAdapter } from '../../src/exports/index';
import type { SqlContract } from '../../src/models/model-lookup';
import { useContractFixture } from '../helpers/contract-fixture';
import { compare } from '../helpers/printed-psl';
import { appPsl, refusal } from './sources';

export const passOutput = 'Pass your contract file with `--output`.';

const options: BetterAuthOptions = { plugins: [twoFactor()] };
const testDir = fileURLToPath(new URL('.', import.meta.url));

function clientOver(contract: SqlContract): PrismaClientLike {
  return {
    contract,
    orm: {},
    transaction: () => Promise.reject(new Error('createSchema opens no transaction')),
  };
}

export async function inDirectory<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
}

/**
 * Project folders inside the package, so that a `prisma.config.ts` written there resolves the package's own dependencies, and `createSchema` called as `auth generate` calls it, for `appPsl` and the two-factor plugin.
 */
export function useGenerateProjects() {
  const fixture = useContractFixture();
  let root: string | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(testDir, '.project-'));
  });
  afterAll(() => (root === undefined ? undefined : rm(root, { recursive: true, force: true })));
  afterEach(() => {
    vi.restoreAllMocks();
  });

  return {
    fixture,
    async projectWith(files: Readonly<Record<string, string>>): Promise<string> {
      if (root === undefined) throw new Error('The project folder is created in beforeAll');
      const dir = await mkdtemp(join(root, 'app-'));
      for (const [path, text] of Object.entries(files)) {
        await mkdir(join(dir, path, '..'), { recursive: true });
        await writeFile(join(dir, path), text);
      }
      return dir;
    },
    /** What `createSchema` returns and what it prints. */
    async generate(file?: string) {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const contract = await fixture().contractOf('sqlite', appPsl);
      const schema = await prismaAdapter(clientOver(contract))(options).createSchema?.(
        options,
        file,
      );
      return { schema, printed: log.mock.calls };
    },
    async refusalFor(reason: string) {
      return refusal(compare(await fixture().contractOf('sqlite', appPsl), options), reason);
    },
  };
}

export function configWithContract(contract: string): string {
  return `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '@prisma/orm-sqlite/config';

export default definePrismaConfig({ orm: defineConfig(${contract}) });
`;
}
