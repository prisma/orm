import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type * as configLoader from '@internal/config-loader';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeContractEmit,
  loadContractSource,
} from '../../src/control-api/operations/contract-emit';

const VIEW_DIAGNOSTIC = {
  code: 'PSL.PRISMA7_VIEW_UNSUPPORTED',
  message: 'View "UserInfo" is not supported; Prisma 8 has no views.',
  sourceId: 'prisma/schema.prisma',
  span: { start: { offset: 477, line: 26, column: 1 }, end: { offset: 481, line: 26, column: 5 } },
};

function configWithSource(output: string, load: () => Promise<unknown>) {
  return {
    family: { id: 'family:test', version: '0.0.1', familyId: 'test-family', emission: {} },
    target: {
      kind: 'target',
      id: 'target:test',
      version: '0.0.1',
      familyId: 'test-family',
      targetId: 'test-target',
    },
    adapter: {
      kind: 'adapter',
      id: 'adapter:test',
      version: '0.0.1',
      familyId: 'test-family',
      targetId: 'test-target',
    },
    extensions: [],
    contract: { source: { load }, output },
  } as unknown as configLoader.PrismaNextConfig;
}

describe('loadContractSource', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'load-contract-source-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the source's summary and diagnostics without writing files", async () => {
    const output = join(tmpDir, 'src/prisma/contract.json');
    const config = configWithSource(output, async () => ({
      ok: false,
      failure: { summary: 'Prisma 7 schema interpretation failed', diagnostics: [VIEW_DIAGNOSTIC] },
    }));

    const result = await loadContractSource(config);

    expect(result.assertNotOk()).toEqual({
      summary: 'Prisma 7 schema interpretation failed',
      diagnostics: [VIEW_DIAGNOSTIC],
      meta: undefined,
    });
    expect(existsSync(join(tmpDir, 'src'))).toBe(false);
  });

  it("returns the source's contract without writing files", async () => {
    const contract = { capabilities: {}, extensions: {} };
    const config = configWithSource(join(tmpDir, 'src/prisma/contract.json'), async () => ({
      ok: true,
      value: contract,
    }));

    const result = await loadContractSource(config);

    expect(result.assertOk()).toBe(contract);
    expect(existsSync(join(tmpDir, 'src'))).toBe(false);
  });

  it('throws the emit error for a malformed source result', async () => {
    const config = configWithSource(join(tmpDir, 'contract.json'), async () => ({ ok: 'yes' }));

    await expect(loadContractSource(config)).rejects.toMatchObject({
      code: 'CONTRACT.SOURCE_LOAD_FAILED',
    });
  });
});

describe('executeContractEmit', () => {
  it('reports a missing output path before a missing source provider', async () => {
    const config = {
      family: { id: 'family:test', version: '0.0.1', familyId: 'test-family', emission: {} },
      contract: {},
    } as unknown as configLoader.PrismaNextConfig;

    await expect(executeContractEmit({ config, cwd: tmpdir() })).rejects.toMatchObject({
      why: expect.stringContaining('must have output path'),
    });
  });
});
