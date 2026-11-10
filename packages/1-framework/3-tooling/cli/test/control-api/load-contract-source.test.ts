import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type * as configLoader from '@internal/config-loader';
import type { CliStructuredError } from '@internal/errors/control';
import { structuredError } from '@internal/utils/structured-error';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';
import { loadContractSource } from '../../src/control-api/operations/load-contract-source';

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
    contract: { source: { format: 'typescript', load }, output },
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
      warnings: [],
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

    expect(result.assertOk()).toEqual({ contract, warnings: [] });
    expect(existsSync(join(tmpDir, 'src'))).toBe(false);
  });

  it('reports a structured error the source throws with its own code, message and meta', async () => {
    const message =
      'Field "Event.e": now() does not apply to codec "pg/text@1". Functions that apply: uuid().';
    const meta = {
      modelName: 'Event',
      fieldName: 'e',
      codecId: 'pg/text@1',
      function: 'now',
      reason: 'generator-not-applicable',
    };
    const config = configWithSource(join(tmpDir, 'contract.json'), async () => {
      throw structuredError('CONTRACT.DEFAULT_INVALID', message, { meta });
    });

    const error = (await loadContractSource(config).catch(
      (caught: unknown) => caught,
    )) as CliStructuredError;

    expect({ error, envelope: error.toEnvelope() }).toMatchObject({
      error: { code: 'CONTRACT.DEFAULT_INVALID', message, meta },
      envelope: { code: 'CONTRACT.DEFAULT_INVALID', summary: message, meta },
    });
  });

  describe('a source that reports a warning', () => {
    const warning = {
      code: 'PSL_DEPRECATED_SCALAR_NAME',
      message: 'Scalar type "Int" is deprecated and will be removed; use "Int32".',
      sourceId: 'prisma/schema.prisma',
      severity: 'warning' as const,
    };
    const warningThen =
      (outcome: () => unknown) =>
      async (context: { reportWarning?: (diagnostic: unknown) => void }) => {
        context.reportWarning?.(warning);
        return outcome();
      };

    it('returns it with the contract', async () => {
      const contract = { capabilities: {}, extensions: {} };
      const config = configWithSource(
        join(tmpDir, 'contract.json'),
        warningThen(() => ({ ok: true, value: contract })) as () => Promise<unknown>,
      );

      expect((await loadContractSource(config)).assertOk()).toEqual({
        contract,
        warnings: [warning],
      });
    });

    it('returns it with the diagnostics of a source that then fails', async () => {
      const config = configWithSource(
        join(tmpDir, 'contract.json'),
        warningThen(() => ({
          ok: false,
          failure: { summary: 'failed', diagnostics: [VIEW_DIAGNOSTIC] },
        })) as () => Promise<unknown>,
      );

      expect((await loadContractSource(config)).assertNotOk()).toMatchObject({
        diagnostics: [VIEW_DIAGNOSTIC],
        warnings: [warning],
      });
    });

    it('lists it after the findings of the error a source then throws', async () => {
      const config = configWithSource(
        join(tmpDir, 'contract.json'),
        warningThen(() => {
          throw structuredError('CONTRACT.DEFAULT_INVALID', 'Default refused');
        }) as () => Promise<unknown>,
      );

      await expect(loadContractSource(config)).rejects.toMatchObject({
        code: 'CONTRACT.DEFAULT_INVALID',
        diagnostics: [
          expect.objectContaining({
            severity: 'warn',
            summary: `prisma/schema.prisma PSL_DEPRECATED_SCALAR_NAME: ${warning.message}`,
          }),
        ],
      });
    });
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
