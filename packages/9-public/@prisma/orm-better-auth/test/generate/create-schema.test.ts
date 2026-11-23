import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BetterAuthOptions } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { join, relative } from 'pathe';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClientLike } from '../../src/adapter';
import { prismaAdapter } from '../../src/exports/index';
import type { SqlContract } from '../../src/models/model-lookup';
import { useContractFixture } from '../helpers/contract-fixture';
import { compare } from '../helpers/printed-psl';
import { appPsl, refusal, twoFactorCode, twoFactorSummary } from './sources';

const fixture = useContractFixture();
const options: BetterAuthOptions = { plugins: [twoFactor()] };
const testDir = fileURLToPath(new URL('.', import.meta.url));
const passOutput = 'Pass your contract file with `--output`.';

/** A project folder inside the package, so that its `prisma.config.ts` resolves the package's own dependencies. */
let project: string;

beforeAll(async () => {
  project = await mkdtemp(join(testDir, '.project-'));
});

afterAll(() => rm(project, { recursive: true, force: true }));

afterEach(() => {
  vi.restoreAllMocks();
});

function clientOver(contract: SqlContract): PrismaClientLike {
  return {
    contract,
    orm: {},
    transaction: () => Promise.reject(new Error('createSchema opens no transaction')),
  };
}

async function projectWith(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(project, 'app-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

async function inDirectory<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
}

/** What `createSchema` returns and what it prints, for the core contract and the two-factor plugin. */
async function generate(file?: string) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const contract = await fixture().contractOf('sqlite', appPsl);
  const schema = await prismaAdapter(clientOver(contract))(options).createSchema?.(options, file);
  return { schema, printed: log.mock.calls };
}

async function refusalFor(reason: string) {
  return refusal(compare(await fixture().contractOf('sqlite', appPsl), options), reason);
}

const config = (contract: string) => `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '@prisma/orm-sqlite/config';

export default definePrismaConfig({ orm: defineConfig(${contract}) });
`;

describe('createSchema for auth generate', () => {
  it('returns the edited file that --output names, relative to the working directory, for Better Auth to overwrite', async () => {
    const dir = await projectWith({ 'prisma/contract.prisma': appPsl });
    const file = join(dir, 'prisma/contract.prisma');
    const path = relative(process.cwd(), file);
    expect({ ...(await generate(file)), onDisk: await readFile(file, 'utf8') }).toEqual({
      schema: { code: twoFactorCode, path, overwrite: true },
      printed: [[twoFactorSummary(path)]],
      onDisk: appPsl,
    });
  });

  it('returns an absolute path for a file outside the working directory', async () => {
    const dir = fixture().workDir.nextPath('outside');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'contract.prisma');
    await writeFile(file, appPsl);
    expect(await generate(file)).toEqual({
      schema: { code: twoFactorCode, path: file, overwrite: true },
      printed: [[twoFactorSummary(file)]],
    });
  });

  it('finds the contract through prisma.config.ts in the working directory', async () => {
    const dir = await projectWith({
      'prisma.config.ts': config("{ contract: './prisma/contract.prisma' }"),
      'prisma/contract.prisma': appPsl,
    });
    expect(await inDirectory(dir, () => generate())).toEqual({
      schema: { code: twoFactorCode, path: 'prisma/contract.prisma', overwrite: true },
      printed: [[twoFactorSummary('prisma/contract.prisma')]],
    });
  });

  it('prints the message when there is neither --output nor prisma.config.ts', async () => {
    const dir = await projectWith({ 'prisma/contract.prisma': appPsl });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because it found no prisma.config.ts in the working directory. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when prisma.config.ts names no contract', async () => {
    const dir = await projectWith({
      'prisma.config.ts':
        "import { definePrismaConfig } from '@prisma/cli-engine';\n\nexport default definePrismaConfig({});\n",
    });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because prisma.config.ts names no contract. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when the file --output names does not exist, and creates nothing', async () => {
    const dir = await projectWith({});
    const file = join(dir, 'prisma/contract.prisma');
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because ${relative(process.cwd(), file)} was not found. ${passOutput}`,
    );
    await expect(generate(file)).rejects.toThrow(expected);
    await expect(readFile(file)).rejects.toThrow('ENOENT');
  });

  it('prints the message for a contract written in TypeScript', async () => {
    const dir = await projectWith({ 'prisma/contract.ts': 'export {};\n' });
    const expected = await refusalFor(
      '`auth generate` did not change your contract, because it is written in TypeScript. Add the equivalent models and fields in TypeScript.',
    );
    await expect(generate(join(dir, 'prisma/contract.ts'))).rejects.toThrow(expected);
  });
});
