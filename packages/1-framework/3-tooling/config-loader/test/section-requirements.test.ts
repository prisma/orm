import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { CliStructuredError, errorConfigValidation } from '@internal/errors/control';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LoadedConfig, loadConfigForSections, requireConfigSections } from '../src/load';

const config = { family: {}, target: {}, adapter: {} } as unknown as PrismaNextConfig;

function loaded(diagnostics: readonly CliStructuredError[]): LoadedConfig {
  return { config, diagnostics };
}

describe('requireConfigSections', () => {
  it('returns the config when there are no diagnostics', () => {
    const result = requireConfigSections(loaded([]), ['family', 'db']);
    expect(result.assertOk()).toBe(config);
  });

  it('returns the config when diagnostics concern other sections', () => {
    const formatterDiagnostic = errorConfigValidation('formatter.indent', {
      section: 'formatter',
    });
    const result = requireConfigSections(loaded([formatterDiagnostic]), ['db', 'driver']);
    expect(result.assertOk()).toBe(config);
  });

  it('fails with the first diagnostic that concerns a required section', () => {
    const formatterDiagnostic = errorConfigValidation('formatter.indent', {
      section: 'formatter',
    });
    const driverDiagnostic = errorConfigValidation('driver.kind', { section: 'driver' });
    const result = requireConfigSections(loaded([formatterDiagnostic, driverDiagnostic]), [
      'driver',
    ]);
    expect(result.assertNotOk()).toBe(driverDiagnostic);
  });

  it('treats a diagnostic without a section as blocking every command', () => {
    const sectionless = new CliStructuredError('CONFIG.VALIDATION_FAILED', 'broken config');
    const result = requireConfigSections(loaded([sectionless]), ['migrations']);
    expect(result.assertNotOk()).toBe(sectionless);
  });
});

// Temp-dir fixtures cannot import @prisma/cli-engine, so they stamp the marker
// the same way definePrismaConfig does: an enumerable $prismaConfig key wrapping the
// orm section.
const PARTIAL_CONFIG_SOURCE = `
export default { $prismaConfig: 1, orm: { family: { kind: 'family' } } };
`;

describe('loadConfigForSections', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'prisma-8-config-sections-')));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    'returns the config when no diagnostic concerns the requested sections',
    async () => {
      const configPath = join(tempDir, 'prisma.config.ts');
      writeFileSync(configPath, PARTIAL_CONFIG_SOURCE);

      const result = await loadConfigForSections(configPath, ['migrations']);

      expect(result.assertOk()).toMatchObject({ family: { kind: 'family' } });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'fails with the diagnostic when it concerns a requested section',
    async () => {
      const configPath = join(tempDir, 'prisma.config.ts');
      writeFileSync(configPath, PARTIAL_CONFIG_SOURCE);

      const result = await loadConfigForSections(configPath, ['target']);

      expect(result.assertNotOk()).toMatchObject({
        code: 'CONFIG.VALIDATION_FAILED',
        meta: { section: 'target' },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'passes a load failure through unchanged',
    async () => {
      const result = await loadConfigForSections(join(tempDir, 'missing.config.ts'), ['target']);

      expect(result.assertNotOk().code).toBe('CONFIG.FILE_NOT_FOUND');
    },
    timeouts.typeScriptCompilation,
  );
});
