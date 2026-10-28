import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStructuredError } from '@internal/utils/structured-error';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { loadContractFromTs } from '../src/load-ts-contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('loadContractFromTs', () => {
  it(
    'loads a valid contract with named export',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const contract = await loadContractFromTs(contractPath);

      expect(contract).toBeDefined();
      expect(contract.targetFamily).toBe('sql');
      expect(contract.target).toBe('postgres');
      expect(contract.storage).toBeDefined();
      expect(contract.domain.namespaces['public']?.models).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'imports the framework the contract uses from where it is installed instead of bundling a copy',
    async () => {
      await loadContractFromTs(join(fixturesDir, 'valid-contract.ts'));

      const recorded: unknown = Reflect.get(globalThis, Symbol.for('prisma.orm.frameworkCopies'));
      expect([...(recorded instanceof Set ? recorded : [])]).not.toContainEqual(
        expect.stringContaining('prisma-8-contract-'),
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'loads a valid contract with default export',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract-default.ts');
      const contract = await loadContractFromTs(contractPath);

      expect(contract).toBeDefined();
      expect(contract.targetFamily).toBe('sql');
      expect(contract.target).toBe('postgres');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects disallowed imports',
    async () => {
      const contractPath = join(fixturesDir, 'disallowed-import.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow('Disallowed imports detected');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects missing contract export',
    async () => {
      const contractPath = join(fixturesDir, 'invalid-export.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract file must export a contract',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects module with other exports but no contract',
    async () => {
      const contractPath = join(fixturesDir, 'other-exports.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract file must export a contract',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects empty module with no exports',
    async () => {
      const contractPath = join(fixturesDir, 'empty-module.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract file must export a contract',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects non-object contract export',
    async () => {
      const contractPath = join(fixturesDir, 'function-export.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export must be an object',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects non-serializable contract export',
    async () => {
      const contractPath = join(fixturesDir, 'non-serializable.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export contains getter/setter',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects functions in contract export',
    async () => {
      const contractPath = join(fixturesDir, 'function-in-object.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export contains function',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects circular references in contract',
    async () => {
      const contractPath = join(fixturesDir, 'json-serialize-error.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export contains circular references',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'uses custom allowlist when provided',
    async () => {
      const contractPath = join(fixturesDir, 'custom-allowlist.ts');

      const contract = await loadContractFromTs(contractPath, {
        allowlist: ['@custom/package/*', '@internal/*', 'node:*'],
      });

      expect(contract).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects imports not in custom allowlist',
    async () => {
      const contractPath = join(fixturesDir, 'disallowed-import.ts');

      await expect(
        loadContractFromTs(contractPath, {
          allowlist: ['@other/package/*'],
        }),
      ).rejects.toThrow('Disallowed imports detected');
    },
    timeouts.typeScriptCompilation,
  );
});

describe('loadContractFromTs structured error codes', () => {
  async function capture(path: string, options?: { allowlist?: string[] }): Promise<unknown> {
    try {
      await loadContractFromTs(path, options);
    } catch (error) {
      return error;
    }
    throw new Error('expected loadContractFromTs to reject');
  }

  it(
    'raises CLI.FILE_NOT_FOUND for a missing contract file',
    async () => {
      const error = await capture(join(fixturesDir, 'does-not-exist.ts'));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({ code: 'CLI.FILE_NOT_FOUND' });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'raises CONTRACT.SOURCE_IMPORT_DISALLOWED for imports outside the allowlist',
    async () => {
      const error = await capture(join(fixturesDir, 'disallowed-import.ts'));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({ code: 'CONTRACT.SOURCE_IMPORT_DISALLOWED' });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'raises CONTRACT.MODULE_EXPORT_MISSING for a module without a contract export',
    async () => {
      const error = await capture(join(fixturesDir, 'empty-module.ts'));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({ code: 'CONTRACT.MODULE_EXPORT_MISSING' });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'raises CONTRACT.EXPORT_INVALID for circular references',
    async () => {
      const error = await capture(join(fixturesDir, 'circular-reference.ts'));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({
        code: 'CONTRACT.EXPORT_INVALID',
        meta: { reason: 'circular' },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'raises CONTRACT.EXPORT_INVALID for a function in the export',
    async () => {
      const error = await capture(join(fixturesDir, 'function-in-object.ts'));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({ code: 'CONTRACT.EXPORT_INVALID' });
    },
    timeouts.typeScriptCompilation,
  );

  it.each([
    ['non-serializable.ts', 'getter'],
    ['function-in-object.ts', 'function'],
    ['circular-reference.ts', 'circular'],
  ])(
    'reports the purity check on %s once, with its own reason and no wrapping',
    async (fixture, reason) => {
      const error = await capture(join(fixturesDir, fixture));
      expect(error).toMatchObject({ code: 'CONTRACT.EXPORT_INVALID', meta: { reason } });
      expect(error).not.toHaveProperty('cause');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    "checks only the export's own properties, as JSON.stringify serializes them, and never runs an inherited getter",
    async () => {
      const contract = await loadContractFromTs(join(fixturesDir, 'inherited-throwing-getter.ts'));
      expect(Object.keys(contract)).toEqual(['foo']);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    "wraps V8's circular-structure error from JSON.stringify as a serialization failure",
    async () => {
      const error = await capture(join(fixturesDir, 'to-json-circular.ts'));
      expect(error).toMatchObject({
        code: 'CONTRACT.EXPORT_INVALID',
        meta: { reason: 'not-json-serializable' },
        cause: expect.any(TypeError),
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'raises CONTRACT.SOURCE_LOAD_FAILED when module evaluation throws a non-Error',
    async () => {
      const error = await capture(join(fixturesDir, 'throws-non-error.ts'));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({
        code: 'CONTRACT.SOURCE_LOAD_FAILED',
        meta: { stage: 'import' },
      });
    },
    timeouts.typeScriptCompilation,
  );
});
