import { twoFactor } from 'better-auth/plugins';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contractMessage } from '../../src/contract/message';
import { compare } from '../helpers/printed-psl';
import { configWithContract, inDirectory, passOutput, useGenerateProjects } from './projects';
import { appPsl, twoFactorCode } from './sources';

const { fixture, projectWith, generate } = useGenerateProjects();
const loader = '@prisma/orm-toolchain/config-loader';

afterEach(() => {
  vi.doUnmock(loader);
});

async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('The call did not throw');
}

async function expectedHead(): Promise<string> {
  const comparison = compare(await fixture().contractOf('sqlite', appPsl), {
    plugins: [twoFactor()],
  });
  return `${contractMessage(comparison)}\n\n\`auth generate\` did not change your contract, because `;
}

describe('createSchema when Prisma config loader is unavailable', () => {
  it('prints the message when the config loader cannot be imported', async () => {
    vi.doMock(loader, () => {
      throw new Error("Cannot find package '@prisma/cli-engine'");
    });
    const dir = await projectWith({
      'prisma.config.ts': configWithContract("{ contract: './prisma/contract.prisma' }"),
      'prisma/contract.prisma': appPsl,
    });
    const head = await expectedHead();
    const message = await messageOf(() => inDirectory(dir, () => generate()));
    expect({
      head: message.slice(0, head.length),
      reason: message.slice(
        head.length,
        head.length + "Prisma's config loader could not be loaded: ".length,
      ),
      tail: message.endsWith(`. ${passOutput}`),
    }).toEqual({ head, reason: "Prisma's config loader could not be loaded: ", tail: true });
  });

  it('prints the message when loading the config throws', async () => {
    vi.doMock(loader, () => ({
      loadConfigForSections: () => Promise.reject(new Error('the config exploded')),
    }));
    const dir = await projectWith({ 'prisma/contract.prisma': appPsl });
    const head = await expectedHead();
    expect(await messageOf(() => inDirectory(dir, () => generate()))).toBe(
      `${head}prisma.config.ts did not load: the config exploded. ${passOutput}`,
    );
  });

  it('does not load the config loader when --output names the file', async () => {
    vi.doMock(loader, () => {
      throw new Error('the config loader was loaded');
    });
    const dir = await projectWith({ 'prisma/contract.prisma': appPsl });
    expect((await generate(join(dir, 'prisma/contract.prisma'))).schema?.code).toBe(twoFactorCode);
  });
});
